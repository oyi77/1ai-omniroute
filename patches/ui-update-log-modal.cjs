// patches/ui-update-log-modal.cjs
// Adds a reusable modal that shows update/log progress.
module.exports = async function (omniroute) {
  const fs = omniroute.require('fs');
  const path = omniroute.require('path');

  const componentPath = path.join(omniroute.process.cwd(), 'src/shared/components/UpdateLogModal.tsx');
  const componentCode = `
import { useState } from "react";
import { Card, Button, Badge } from "@/shared/components";

interface UpdateLogModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  logs: string[];
  isUpdating: boolean;
  progress?: number;
}

export default function UpdateLogModal({
  isOpen,
  onClose,
  title,
  logs,
  isUpdating,
  progress
}: UpdateLogModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-[500px] max-w-[90vw] p-6">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-semibold">{title}</h2>
          <Button size="sm" variant="secondary" onClick={onClose}>
            <span className="material-symbols-outlined">close</span>
          </Button>
        </div>

        {progress !== undefined && (
          <div className="mb-4">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-emerald-500 h-2.5 rounded-full transition-all"
                style={{ width: \`\${progress}%\` }}
              ></div>
            </div>
            <p className="text-center text-xs text-text-muted mt-1">
              {progress}% Complete
            </p>
          </div>
        )}

        <div className="max-h-[400px] overflow-y-auto bg-gray-50 p-4 rounded mb-4">
          {logs.length > 0 ? (
            logs.map((log, index) => (
              <div key={index} className="mb-2 p-2 rounded bg-white/50">
                <span className="text-xs font-mono text-text-muted">
                  {new Date().toLocaleTimeString()}
                </span>
                <span className="ml-2">{log}</span>
              </div>
            ))
          ) : (
            <p className="text-text-muted text-center py-4">
              No logs yet...
            </p>
          )}
        </div>

        <div className="flex justify-end">
          {!isUpdating && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onClose}
            >
              Close
            </Button>
          )}
          {isUpdating && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onClose}
            >
              Close (Update continues in background)
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
`;

  // Ensure the directory exists
  const dir = path.dirname(componentPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write the file (overwrite if it already exists)
  fs.writeFileSync(componentPath, componentCode.trim(), 'utf8');

  omniroute.logger.info('[patch] ui-update-log-modal: UpdateLogModal component installed');
};