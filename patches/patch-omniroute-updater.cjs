// patches/patch-omniroute-updater.cjs
// Replaces OmniRouteUpdater.tsx with modal-based version that uses streaming logs

module.exports = async function (omniroute) {
  const fs = omniroute.require("fs");
  const path = omniroute.require("path");

  const filePath = path.join(
    omniroute.process.cwd(),
    "src/app/(dashboard)/dashboard/settings/components/OmniRouteUpdater.tsx",
  );
  if (!fs.existsSync(filePath)) {
    omniroute.logger.error(
      `[patch] patch-omniroute-updater: File not found ${filePath}`,
    );
    return;
  }

  let code = fs.readFileSync(filePath, "utf8");

  // Skip if already has modal integration with streaming
  if (
    code.includes("UpdateLogModal") &&
    code.includes("updateModalOpen") &&
    code.includes("showConfirm")
  ) {
    omniroute.logger.info(
      "[patch] patch-omniroute-updater: Already has modal integration, skipping.",
    );
    return;
  }

  const newCode = `"use client";

import { useState, useEffect } from "react";
import { Card, Button, Modal } from "@/shared/components";
import UpdateLogModal from "@/shared/components/UpdateLogModal";

export default function OmniRouteUpdater() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  const [updateLogs, setUpdateLogs] = useState([]);
  const [updateProgress, setUpdateProgress] = useState(null);

  const loadStatus = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/system/version");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err) {
      console.error("Failed to load OmniRoute status:", err);
    } finally {
      setLoading(false);
    }
  };

  const checkUpdate = async () => {
    setCheckingUpdate(true);
    setMessage("Checking for updates...");
    try {
      const res = await fetch("/api/openclaw/omniroute/check-update");
      const data = await res.json();
      if (data.updateAvailable) {
        setMessage(\`Update available: \${data.current} → \${data.latest}\`);
      } else {
        setMessage("Already on latest version");
      }
      loadStatus();
    } catch (err) {
      setMessage("Error checking update: " + err.message);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const performUpdate = async () => {
    setShowConfirm(false);
    setUpdateModalOpen(true);
    setUpdateLogs(["Starting OmniRoute update..."]);
    setUpdateProgress(0);
    setUpdating(true);

    try {
      const res = await fetch("/api/openclaw/omniroute/update", {
        method: "POST",
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || "Update failed");
      }

      const reader = res.body?.getReader();
      if (!reader) {
        const data = await res.json();
        if (data.logs) setUpdateLogs(data.logs);
        if (data.progress !== undefined) setUpdateProgress(data.progress);
        if (!data.success) throw new Error(data.message || "Update failed");
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
            if (data.log) {
              setUpdateLogs((prev) => [...prev, data.log]);
            }
            if (data.progress !== undefined) {
              setUpdateProgress(data.progress);
            }
            if (data.error) {
              throw new Error(data.error);
            }
          } catch (e) {
            if (e.message && !e.message.includes("Update failed")) {
              setUpdateLogs((prev) => [...prev, line]);
            } else if (e.message) {
              throw e;
            }
          }
        }
      }

      setUpdateLogs((prev) => [...prev, "✓ Update completed successfully!"]);
      setUpdateProgress(100);
      setMessage("Update completed!");
      loadStatus();
    } catch (err) {
      setUpdateLogs((prev) => [...prev, \`ERROR: \${err.message}\`]);
      setUpdateProgress(null);
      setMessage("Update failed: " + err.message);
    } finally {
      setUpdating(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined text-xl text-primary">cloud_sync</span>
          <h2 className="text-lg font-bold">OmniRoute Updater</h2>
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
                  <p className="text-xs text-text-muted uppercase font-bold tracking-wider mb-1">
                    Current Version
                  </p>
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
                    disabled={checkingUpdate || updating}
                  >
                    {checkingUpdate ? "Checking..." : "Check"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={loadStatus} disabled={updating}>
                    Reload
                  </Button>
                </div>
              </div>

              <div className="flex gap-3">
                {status.current !== status.latest ? (
                  <Button
                    variant="primary"
                    icon="upgrade"
                    onClick={() => setShowConfirm(true)}
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
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Confirm Update"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowConfirm(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={performUpdate}>
              Update Now
            </Button>
          </>
        }
      >
        <p className="text-text-muted">
          Update OmniRoute to the latest version? This will pull changes from GitHub, rebuild, and
          restart the service.
        </p>
      </Modal>

      <UpdateLogModal
        isOpen={updateModalOpen}
        onClose={() => setUpdateModalOpen(false)}
        title="Updating OmniRoute"
        logs={updateLogs}
        isUpdating={updating}
        progress={updateProgress}
      />
    </>
  );
}
`;

  fs.writeFileSync(filePath, newCode, "utf8");
  omniroute.logger.info(
    "[patch] patch-omniroute-updater: OmniRouteUpdater updated with modal.",
  );
};
