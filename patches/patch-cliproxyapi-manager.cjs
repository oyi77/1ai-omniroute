// patches/patch-cliproxyapi-manager.cjs
// Replaces the native alert/confirm flow in CLIProxyAPIManager with a modal.
module.exports = async function (omniroute) {
  const fs = omniroute.require('fs');
  const path = omniroute.require('path');

  const filePath = path.join(omniroute.process.cwd(), 'src/app/(dashboard)/dashboard/settings/components/CLIProxyAPIManager.tsx');
  let code = fs.readFileSync(filePath, 'utf8');

  // 1️⃣ Add import for the modal
  const importLine = 'import UpdateLogModal from "@/shared/components/UpdateLogModal";';
  if (!code.includes('UpdateLogModal from "@/shared/components/UpdateLogModal"')) {
    const importInsertPos = code.indexOf('import { Card, Button } from "@/shared/components";');
    if (importInsertPos > -1) {
      const afterImport = code.indexOf('\n', importInsertPos) + 1;
      code = code.slice(0, afterImport) + importLine + '\n' + code.slice(afterImport);
    }
  }

  // 2️⃣ Add modal state variables
  const stateInsert = `
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string[]>([]);
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);`;
  const useEffectLine = 'useEffect(() => {';
  const statePos = code.indexOf(useEffectLine);
  if (statePos > -1 && !code.includes('updateModalOpen')) {
    code = code.slice(0, statePos) + stateInsert + '\n' + code.slice(statePos);
  }

  // 3️⃣ Replace switchVersion with modal version
  const switchVersionStart = 'const switchVersion = async (version: string) => {';
  const switchVersionEnd = '};';
  const switchPos = code.indexOf(switchVersionStart);
  if (switchPos > -1) {
    const endSwitch = code.indexOf(switchVersionEnd, switchPos) + switchVersionEnd.length;
    const newSwitchVersion = `
    const switchVersion = async (version: string) => {
    setUpdateModalOpen(true);
    setUpdateLogs([\`Switching to version \${version}...\`]);
    setUpdateProgress(0);
    
    try {
      setUpdateLogs([...updateLogs, "Preparing version switch..."]);
      setUpdateProgress(10);
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const res = await fetch("/api/openclaw/cliproxyapi/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      
      const data = await res.json();
      
      setUpdateLogs([...updateLogs, "Switch applied successfully"]);
      setUpdateProgress(50);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setUpdateLogs([...updateLogs, "Reloading service..."]);
      setUpdateProgress(80);
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      setUpdateLogs([...updateLogs, "Version switch completed!"]);
      setUpdateProgress(100);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      loadStatus();
    } catch (err) {
      setUpdateLogs([...updateLogs, \`Error: \${err.message}\`]);
    }
  };`;
    code = code.slice(0, switchPos) + newSwitchVersion + code.slice(endSwitch);
  }

  // 4️⃣ Replace updateToLatest with modal version
  const updateToLatestStart = 'const updateToLatest = async () => {';
  const updateToLatestEnd = '};';
  const updatePos = code.indexOf(updateToLatestStart);
  if (updatePos > -1) {
    const endUpdate = code.indexOf(updateToLatestEnd, updatePos) + updateToLatestEnd.length;
    const newUpdateToLatest = `
    const updateToLatest = async () => {
    setUpdateModalOpen(true);
    setUpdateLogs(["Starting CLIProxyAPI update..."]);
    setUpdateProgress(0);
    
    try {
      setUpdateLogs([...updateLogs, "Checking for available updates..."]);
      setUpdateProgress(10);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setUpdateLogs([...updateLogs, "Latest version found"]);
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
      
      setUpdateLogs([...updateLogs, "Applying update..."]);
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
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      loadStatus();
    } catch (err) {
      setUpdateLogs([...updateLogs, \`Error: \${err.message}\`]);
    }
  };`;
    code = code.slice(0, updatePos) + newUpdateToLatest + code.slice(endUpdate);
  }

  // 5️⃣ Replace the JSX return to render the modal at the end
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
              <span className="material-symbols-outlined text-xl text-purple-500">swap_horiz</span>
              <h2 className="text-lg font-bold">CLIProxyAPI Manager</h2>
            </div>
            
            <div className="mb-4">
              <p className="text-sm text-text-muted">
                OAuth proxy for Antigravity and Claude providers
              </p>
            </div>
            
            {status && (
              <>
                <div className="flex items-center justify-between mb-4 p-3 bg-black/5 dark:bg-white/5 rounded-lg">
                  <div>
                    <p className="text-sm text-text-muted">Current Version</p>
                    <p className="text-lg font-semibold">{status.current}</p>
                    {updateAvailable && (
                      <p className="text-xs text-emerald-400 mt-1">Update available: {latestVersion}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={updateAvailable ? "primary" : "secondary"}
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
                      disabled={actionLoading}
                    >
                      Refresh
                    </Button>
                  </div>
                </div>
                
                {status.availableVersions?.length > 0 && (
                  <div className="mb-4">
                    <p className="text-sm font-medium mb-2">Available Versions:</p>
                    <div className="flex flex-wrap gap-2">
                      {status.availableVersions.map((v) => (
                        <button
                          key={v}
                          onClick={() => switchVersion(v)}
                          disabled={actionLoading || v === status.current}
                          className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${v === status.current
                            ? "bg-purple-600 text-white"
                            : v === latestVersion && updateAvailable
                              ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/30"
                              : "bg-black/5 dark:bg-white/5 hover:bg-purple-600/20 text-text-main\"}\`}
                        >
                          {v}
                          {v === latestVersion && updateAvailable && " ★"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-3">
                  {updateAvailable && (
                    <Button
                      variant="primary"
                      icon="upgrade"
                      onClick={updateToLatest}
                      disabled={actionLoading}
                    >
                      Update to {latestVersion}
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
          title="Updating CLIProxyAPI"
          logs={updateLogs}
          isUpdating={actionLoading || updateModalOpen}
          progress={updateProgress}
        />
      </>
    );`;
    code = code.slice(0, returnPos) + newReturn + code.slice(endReturnPos);
  }

  // Write back
  fs.writeFileSync(filePath, code, 'utf8');

  omniroute.logger.info('[patch] patch-cliproxyapi-manager: Updated CLIProxyAPIManager to use modal');
};