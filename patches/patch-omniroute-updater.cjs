// patches/patch-omniroute-updater.cjs
// Replaces the native alert/confirm flow in OmniRouteUpdater with a modal.
// VERSION: 2026.03.25.1 (Robust Regex Edition)

module.exports = async function (omniroute) {
  const fs = omniroute.require('fs');
  const path = omniroute.require('path');

  const filePath = path.join(omniroute.process.cwd(), 'src/app/(dashboard)/dashboard/settings/components/OmniRouteUpdater.tsx');
  if (!fs.existsSync(filePath)) {
    omniroute.logger.error(`[patch] patch-omniroute-updater: File not found ${filePath}`);
    return;
  }
  
  let code = fs.readFileSync(filePath, 'utf8');

  // Skip if already patched (check for state variables)
  if (code.includes('updateModalOpen')) {
    omniroute.logger.info('[patch] patch-omniroute-updater: File already patched, skipping.');
    return;
  }

  // 1️⃣ Add import for the modal
  const importLine = 'import UpdateLogModal from "@/shared/components/UpdateLogModal";';
  if (!code.includes(importLine)) {
    const componentImport = 'import { Card, Button } from "@/shared/components";';
    code = code.replace(componentImport, `${componentImport}\n${importLine}`);
  }

  // 2️⃣ Add state variables for the modal inside the component
  const stateInsert = `
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);`;
  
  const componentStart = 'export default function OmniRouteUpdater() {';
  code = code.replace(componentStart, `${componentStart}${stateInsert}`);

  // 3️⃣ Replace the performUpdate function
  const performUpdateStart = 'const performUpdate = async () => {';
  const performUpdateEnd = '};';
  
  const startIdx = code.indexOf(performUpdateStart);
  if (startIdx !== -1) {
    // Find the NEXT closing brace that belongs to this function
    // In the original file, it ends with setUpdating(false); \n };
    const searchTarget = 'setUpdating(false);';
    const endSearchIdx = code.indexOf(searchTarget, startIdx);
    const finalEndIdx = code.indexOf(performUpdateEnd, endSearchIdx) + performUpdateEnd.length;
    
    const newPerformUpdate = `const performUpdate = async () => {
    setUpdateModalOpen(true);
    setUpdateLogs(["Starting update process..."]);
    setUpdateProgress(0);
    
    try {
      setUpdateLogs(prev => [...prev, "Checking GitHub repository..."]);
      setUpdateProgress(10);
      
      const res = await fetch("/api/openclaw/omniroute/update", { method: "POST" });
      const reader = res.body?.getReader();
      if (!reader) throw new Error("ReadableStream not supported");

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\\n").filter(l => l.trim());
        
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.log) setUpdateLogs(prev => [...prev, data.log]);
            if (data.progress !== undefined) setUpdateProgress(data.progress);
            if (data.error) throw new Error(data.error);
          } catch (e) {
            setUpdateLogs(prev => [...prev, line]);
          }
        }
      }
      
      setUpdateLogs(prev => [...prev, "Update completed successfully!"]);
      setUpdateProgress(100);
      loadStatus();
    } catch (err: any) {
      setUpdateLogs(prev => [...prev, \`Error: \${err.message}\`]);
      setUpdateProgress(null);
    }
  };`;
    
    code = code.slice(0, startIdx) + newPerformUpdate + code.slice(finalEndIdx);
  }

  // 4️⃣ Fix the JSX section to include the Modal
  const returnStart = 'return (';
  const returnEnd = '  );';
  const returnIdx = code.lastIndexOf(returnStart);
  const endIdx = code.lastIndexOf(returnEnd);
  
  if (returnIdx !== -1 && endIdx !== -1) {
    const newReturn = `return (
      <>
        <Card className="p-0 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-xl text-primary">cloud_sync</span>
              <h2 className="text-lg font-bold">OmniRoute Updater</h2>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-text-muted">
                Check and install OmniRoute updates from GitHub source
              </p>
            </div>
            
            {status && (
              <>
                <div className="flex items-center justify-between mb-4 p-4 bg-bg-subtle border border-border rounded-xl">
                  <div>
                    <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">Current Version</p>
                    <p className="text-lg font-mono font-bold text-primary">{status.current}</p>
                    {status.latest && status.current !== status.latest && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20 w-fit">
                        <span className="material-symbols-outlined text-sm">auto_awesome</span>
                        Latest: {status.latest}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={status.current !== status.latest ? "primary" : "secondary"}
                      icon="refresh"
                      onClick={checkUpdate}
                      disabled={checkingUpdate}
                    >
                      {checkingUpdate ? "Checking..." : "Check"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={loadStatus}
                      disabled={updating}
                    >
                      Reload
                    </Button>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  {status.current !== status.latest ? (
                    <Button
                      variant="primary"
                      icon="upgrade"
                      onClick={performUpdate}
                      disabled={updating}
                      fullWidth
                    >
                      {updating ? "Updating..." : \`Upgrade to \${status.latest}\`}
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-text-muted italic py-2">
                      <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                      System is up to date
                    </div>
                  )}
                </div>
                
                {message && <p className="mt-3 text-xs text-text-muted bg-black/20 p-2 rounded font-mono">{message}</p>}
              </>
            )}
          </div>
        </Card>
        
        <UpdateLogModal
          isOpen={updateModalOpen}
          onClose={() => setUpdateModalOpen(false)}
          title="Updating OmniRoute"
          logs={updateLogs}
          isUpdating={updating || updateModalOpen}
          progress={updateProgress}
        />
      </>
    );`;
    code = code.slice(0, returnIdx) + newReturn + code.slice(endIdx + returnEnd.length);
  }

  // Write the modified file back
  fs.writeFileSync(filePath, code, 'utf8');

  omniroute.logger.info('[patch] patch-omniroute-updater: OmniRouteUpdater modernized successfully.');
};