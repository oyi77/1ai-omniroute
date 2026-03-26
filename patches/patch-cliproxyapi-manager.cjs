// patches/patch-cliproxyapi-manager.cjs
// Replaces CLIProxyAPIManager.tsx with modal-based version that uses streaming logs

module.exports = async function (omniroute) {
  const fs = omniroute.require("fs");
  const path = omniroute.require("path");

  const filePath = path.join(
    omniroute.process.cwd(),
    "src/app/(dashboard)/dashboard/settings/components/CLIProxyAPIManager.tsx",
  );
  if (!fs.existsSync(filePath)) {
    omniroute.logger.error(
      `[patch] patch-cliproxyapi-manager: File not found ${filePath}`,
    );
    return;
  }

  let code = fs.readFileSync(filePath, "utf8");

  // Skip if already has modal integration with streaming
  if (
    code.includes("UpdateLogModal") &&
    code.includes("updateModalOpen") &&
    code.includes("confirmAction")
  ) {
    omniroute.logger.info(
      "[patch] patch-cliproxyapi-manager: Already has modal integration, skipping.",
    );
    return;
  }

  const newCode = `"use client";

import { useState, useEffect } from "react";
import { Card, Button, Modal } from "@/shared/components";
import UpdateLogModal from "@/shared/components/UpdateLogModal";

export default function CLIProxyAPIManager() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState("");
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateLogs, setUpdateLogs] = useState([]);
  const [updateProgress, setUpdateProgress] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/openclaw/cliproxyapi");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.availableVersions?.length > 0) {
          const latest = data.availableVersions[data.availableVersions.length - 1];
          setLatestVersion(latest);
          setUpdateAvailable(latest !== data.current);
        }
      }
    } catch (err) {
      console.error("Failed to load CLIProxyAPI status:", err);
    } finally {
      setLoading(false);
    }
  };

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    setMessage("Checking for updates...");
    try {
      const res = await fetch("/api/openclaw/cliproxyapi/check-update");
      const data = await res.json();
      if (data.updateAvailable) {
        setUpdateAvailable(true);
        setLatestVersion(data.latestVersion);
        setMessage(\`Update available: \${data.current} → \${data.latestVersion}\`);
      } else {
        setUpdateAvailable(false);
        setMessage("Already on latest version");
      }
    } catch (err) {
      setMessage("Error checking update: " + err.message);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const runUpdateAction = async (endpoint, body) => {
    setUpdateModalOpen(true);
    setUpdateLogs(["Starting CLIProxyAPI update..."]);
    setUpdateProgress(0);
    setActionLoading(true);
    setConfirmAction(null);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Action failed");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const data = await res.json();
        if (data.logs) setUpdateLogs(data.logs);
        else setUpdateLogs([data.message || "Done"]);
        setUpdateProgress(100);
        if (!data.success && data.error) throw new Error(data.error || data.message);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.log) setUpdateLogs((prev) => [...prev, data.log]);
            if (data.progress !== undefined) setUpdateProgress(data.progress);
            if (data.error) throw new Error(data.error);
          } catch (e) {
            if (e.message && !e.message.includes("failed")) {
              setUpdateLogs((prev) => [...prev, line]);
            } else if (e.message) {
              throw e;
            }
          }
        }
      }

      setUpdateLogs((prev) => [...prev, "✓ Completed successfully!"]);
      setUpdateProgress(100);
      setMessage("Action completed!");
      loadStatus();
    } catch (err) {
      setUpdateLogs((prev) => [...prev, \`ERROR: \${err.message}\`]);
      setUpdateProgress(null);
      setMessage("Failed: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const switchVersion = (version) => {
    setConfirmAction({ type: "switch", version });
  };

  const updateToLatest = () => {
    setConfirmAction({ type: "update" });
  };

  const executeConfirmedAction = () => {
    if (!confirmAction) return;
    if (confirmAction.type === "switch" && confirmAction.version) {
      runUpdateAction("/api/openclaw/cliproxyapi/switch", { version: confirmAction.version });
    } else if (confirmAction.type === "update") {
      runUpdateAction("/api/openclaw/cliproxyapi/update");
    }
  };

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-xl text-purple-500">swap_horiz</span>
          <h2 className="text-lg font-bold">CLIProxyAPI Manager</h2>
        </div>
        <p className="text-text-muted">Loading...</p>
      </Card>
    );
  }

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
              <div className="flex items-center justify-between mb-4 p-4 bg-bg-subtle border border-border rounded-xl">
                <div>
                  <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">
                    Current Version
                  </p>
                  <p className="text-lg font-mono font-bold text-purple-400">{status.current}</p>
                  {updateAvailable && (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20 w-fit">
                      <span className="material-symbols-outlined text-sm">auto_awesome</span>
                      Latest: {latestVersion}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={updateAvailable ? "primary" : "secondary"}
                    icon="update"
                    onClick={checkUpdate}
                    disabled={checkingUpdate || actionLoading}
                  >
                    {checkingUpdate ? "Checking..." : "Check"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={loadStatus}
                    disabled={actionLoading}
                  >
                    Reload
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
                        className={\`px-3 py-1.5 rounded text-sm font-medium transition-colors \${
                          v === status.current
                            ? "bg-purple-600 text-white"
                            : v === latestVersion && updateAvailable
                              ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 hover:bg-emerald-600/30"
                              : "bg-black/5 dark:bg-white/5 hover:bg-purple-600/20 text-text-main"
                        }\`}
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
                    fullWidth
                  >
                    {actionLoading ? "Updating..." : \`Update to \${latestVersion}\`}
                  </Button>
                )}
              </div>

              {message && !updateModalOpen && (
                <p className="mt-3 text-xs text-text-muted bg-black/20 p-2 rounded font-mono">
                  {message}
                </p>
              )}
            </>
          )}
        </div>
      </Card>

      <Modal
        isOpen={confirmAction !== null}
        onClose={() => setConfirmAction(null)}
        title={confirmAction?.type === "switch" ? "Switch Version" : "Confirm Update"}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={executeConfirmedAction}>
              {confirmAction?.type === "switch" ? "Switch" : "Update Now"}
            </Button>
          </>
        }
      >
        <p className="text-text-muted">
          {confirmAction?.type === "switch"
            ? \`Switch CLIProxyAPI to version \${confirmAction.version}? The service will be restarted.\`
            : \`Update CLIProxyAPI to the latest version (\${latestVersion})?\`}
        </p>
      </Modal>

      <UpdateLogModal
        isOpen={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        title="Updating CLIProxyAPI"
        logs={updateLogs}
        isUpdating={actionLoading}
        progress={updateProgress}
      />
    </>
  );
}
`;

  fs.writeFileSync(filePath, newCode, "utf8");
  omniroute.logger.info(
    "[patch] patch-cliproxyapi-manager: CLIProxyAPIManager updated with modal.",
  );
};
