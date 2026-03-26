// patches/ui-update-log-modal.cjs
// Adds a reusable modal that shows update/log progress.
// NOTE: This patch is a no-op if the component already exists in omniroute-src.

module.exports = async function (omniroute) {
  const fs = omniroute.require("fs");
  const path = omniroute.require("path");

  const componentPath = path.join(
    omniroute.process.cwd(),
    "src/shared/components/UpdateLogModal.tsx",
  );

  // Skip if component already exists (from omniroute-src)
  if (fs.existsSync(componentPath)) {
    const existingCode = fs.readFileSync(componentPath, "utf8");
    if (
      existingCode.includes("UpdateLogModal") &&
      existingCode.includes("isUpdating")
    ) {
      omniroute.logger.info(
        "[patch] ui-update-log-modal: UpdateLogModal component already exists, skipping.",
      );
      return;
    }
  }

  // Create the component if it doesn't exist
  const componentCode = `
"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/shared/utils/cn";
import Button from "./Button";

interface UpdateLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  logs: string[];
  isUpdating: boolean;
  progress?: number | null;
}

export default function UpdateLogModal({
  isOpen,
  onClose,
  title,
  logs,
  isUpdating,
  progress,
}: UpdateLogModalProps) {
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={!isUpdating ? onClose : undefined}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-xl bg-surface border border-black/10 dark:border-white/10 rounded-xl shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between p-4 border-b border-black/5 dark:border-white/5">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 mr-2" aria-hidden="true">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F56]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#FFBD2E]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#27C93F]" />
            </div>
            <span className="material-symbols-outlined text-lg text-primary">
              {isUpdating ? "sync" : "check_circle"}
            </span>
            <h2 className="text-base font-semibold text-text-main">{title}</h2>
          </div>
        </div>

        {progress !== null && progress !== undefined && (
          <div className="px-4 pt-4">
            <div className="w-full bg-bg-subtle rounded-full h-2">
              <div
                className={cn(
                  "h-2 rounded-full transition-all duration-500",
                  progress >= 100 ? "bg-emerald-500" : "bg-primary"
                )}
                style={{ width: \`\${Math.min(100, Math.max(0, progress))}%\` }}
              />
            </div>
            <p className="text-xs text-text-muted text-right mt-1">{progress}%</p>
          </div>
        )}

        <div className="p-4">
          <div className="bg-bg-subtle rounded-lg p-3 max-h-[300px] overflow-y-auto font-mono text-xs">
            {logs.length > 0 ? (
              logs.map((log, index) => (
                <div
                  key={index}
                  className={cn(
                    "py-1 border-b border-black/5 dark:border-white/5 last:border-0",
                    log.includes("ERROR") || log.includes("Error:")
                      ? "text-red-400"
                      : log.includes("✓") || log.includes("success")
                        ? "text-emerald-400"
                        : "text-text-muted"
                  )}
                >
                  <span className="text-text-muted/50 mr-2">
                    [{String(index + 1).padStart(2, "0")}]
                  </span>
                  {log}
                </div>
              ))
            ) : (
              <p className="text-text-muted text-center py-4">
                {isUpdating ? "Starting update..." : "No logs yet"}
              </p>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-black/5 dark:border-white/5">
          {isUpdating ? (
            <Button size="sm" variant="secondary" onClick={onClose}>
              Close (continues in background)
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={onClose}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
`;

  // Ensure the directory exists
  const dir = path.dirname(componentPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write the file
  fs.writeFileSync(componentPath, componentCode.trim(), "utf8");

  omniroute.logger.info(
    "[patch] ui-update-log-modal: UpdateLogModal component installed",
  );
};
