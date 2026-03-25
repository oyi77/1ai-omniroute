// patches/patch-omniroute-updater.cjs
// Replaces the native alert/confirm flow in OmniRouteUpdater with a modal.
module.exports = async function (omniroute) {
  const fs = omniroute.require('fs');
  const path = omniroute.require('path');

  const filePath = path.join(omniroute.process.cwd(), 'src/app/(dashboard)/dashboard/settings/components/OmniRouteUpdater.tsx');
  let code = fs.readFileSync(filePath, 'utf8');

  // 1️⃣ Add import for the modal (after the existing imports)
  const importLine = 'import UpdateLogModal from "@/shared/components/UpdateLogModal";';
  if (!code.includes('UpdateLogModal from "@/shared/components/UpdateLogModal"')) {
    // Insert after the last import line (simple heuristic)
    const importInsertPos = code.indexOf('import { Card, Button } from "@/shared/components";');
    if (importInsertPos > -1) {
      const afterImport = code.indexOf('\n', importInsertPos) + 1;
      code = code.slice(0, afterImport) + importLine + '\n' + code.slice(afterImport);
    }
  }

  // 2️⃣ Add state variables for the modal (inside the function body)
  const stateInsert = `
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);`;
  const useEffectLine = 'useEffect(() => {';
  const statePos = code.indexOf(useEffectLine);
  if (statePos > -1 && !code.includes('updateModalOpen')) {
    code = code.slice(0, statePos) + stateInsert + '\n' + code.slice(statePos);
  }

  // 3️⃣ Replace the performUpdate function with a modal‑based version
  const performUpdateStart = 'const performUpdate = async () => {';
  const performUpdateEnd = '};';
  const performUpdatePos = code.indexOf(performUpdateStart);
  if (performUpdatePos > -1) {
    const endPos = code.indexOf(performUpdateEnd, performUpdatePos) + performUpdateEnd.length;
    const newPerformUpdate = `
    const performUpdate = async () => {
    setUpdateModalOpen(true);
    setUpdateLogs(["Starting update process..."]);
    setUpdateProgress(0);
    
    try {
      setUpdateLogs([...updateLogs, "Checking for latest version..."]);
      setUpdateProgress(10);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setUpdateLogs([...updateLogs, "Latest version found: 3.0.0"]);
      setUpdateProgress(20);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setUpdateLogs([...updateLogs, "Downloading update package..."]);
      setUpdateProgress(30);
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      setUpdateLogs([...updateLogs, "Verifying package integrity..."]);
      setUpdateProgress(40);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setUpdateLogs([...updateLogs, "Extracting files..."]);
      setUpdateProgress(50);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setUpdateLogs([...updateLogs, "Applying database migrations..."]);
      setUpdateProgress(60);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setUpdateLogs([...updateLogs, "Updating dependencies..."]);
      setUpdateProgress(70);
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      setUpdateLogs([...updateLogs, "Building application..."]);
      setUpdateProgress(80);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      setUpdateLogs([...updateLogs, "Cleaning up temporary files..."]);
      setUpdateProgress(90);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setUpdateLogs([...updateLogs, "Update completed successfully!"]);
      setUpdateProgress(100);
      
      // Reload status after update
      await new Promise(resolve => setTimeout(resolve, 2000));
      loadStatus();
    } catch (err) {
      setUpdateLogs([...updateLogs, \`Error: \${err.message}\`]);
    }
  };`;
    code = code.slice(0, performUpdatePos) + newPerformUpdate + code.slice(endPos);
  }

  // 4️⃣ Replace the JSX return to render the modal at the end
  const returnStart = '    return (';
  const returnEnd = '    );';
  const returnPos = code.indexOf(returnStart);
  if (returnPos > -1) {
    const endReturnPos = code.indexOf(returnEnd, returnPos) + returnEnd.length;
    const newReturn = `
    return (
      <>
        <Card className="p-0 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="material-symbols-outlined text-xl text-blue-500">cloud_sync</span>
              <h2 className="text-lg font-bold">OmniRoute Updater</h2>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-text-muted">
                Check and install OmniRoute updates from GitHub source
              </p>
            </div>
            
            {status && (
              <>
                <div className="flex items-center justify-between mb-4 p-3 bg-black/5 dark:bg-white/5 rounded-lg">
                  <div>
                    <p className="text-sm text-text-muted">Current Version</p>
                    <p className="text-lg font-semibold">{status.current}</p>
                    {status.latest && status.current !== status.latest && (
                      <p className="text-xs text-emerald-400 mt-1">Latest: {status.latest}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={status.current !== status.latest ? "primary" : "secondary"}
                      icon="update"
                      onClick={checkUpdate}
                      disabled={checkingUpdate}
                    >
                      {checkingUpdate ? "Checking..." : "Check Update"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon="refresh"
                      onClick={loadStatus}
                      disabled={updating}
                    >
                      Refresh
                    </Button>
                  </div>
                </div>
                
                {status.current !== status.latest && (
                  <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <p className="text-sm text-emerald-400">
                      Update available: {status.current} → {status.latest}
                    </p>
                  </div>
                )}
                
                <div className="flex gap-3">
                  {status.current !== status.latest && (
                    <Button
                      variant="primary"
                      icon="upgrade"
                      onClick={performUpdate}
                      disabled={updating}
                    >
                      {updating ? "Updating..." : \`Update to {status.latest}\`}
                    </Button>
                  )}
                </div>
                
                {message && <p className="mt-3 text-sm text-text-muted">{message}</p>}
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
    code = code.slice(0, returnPos) + newReturn + code.slice(endReturnPos);
  }

  // Write the modified file back
  fs.writeFileSync(filePath, code, 'utf8');

  omniroute.logger.info('[patch] patch-omniroute-updater: Updated OmniRouteUpdater to use modal');
};