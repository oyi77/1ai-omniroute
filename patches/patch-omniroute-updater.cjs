// patches/patch-omniroute-updater.cjs
// Replaces the native alert/confirm flow in OmniRouteUpdater with a modal.
// NOTE: This patch is a no-op if the new modal-based implementation is already in place.

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

  // Skip if already has modal integration (new implementation from omniroute-src)
  if (code.includes("UpdateLogModal") && code.includes("updateModalOpen")) {
    omniroute.logger.info(
      "[patch] patch-omniroute-updater: File already has modal integration, skipping.",
    );
    return;
  }

  // If we reach here, the file is in the old state (pre-modal).
  // The new implementation in omniroute-src should be used instead.
  // This patch is no longer needed for new installations.
  omniroute.logger.info(
    "[patch] patch-omniroute-updater: Legacy file detected. Consider updating omniroute-src to get the new modal-based UI.",
  );
};
