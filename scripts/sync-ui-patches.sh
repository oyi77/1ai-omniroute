#!/bin/bash
set -e

SRC="/home/openclaw/1ai-omniroute/src"
DEST="/home/openclaw/omniroute-src/src"
PATCH_LOG="/home/openclaw/.omniroute/patches/sync.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$PATCH_LOG"
}

log "=== Syncing UI patches from 1ai-omniroute ==="

# Sync API routes (patches toggle)
if [ -d "$SRC/app/api/patches" ]; then
  mkdir -p "$DEST/app/api"
  cp -rf "$SRC/app/api/patches" "$DEST/app/api/"
  log "Synced patches API routes"
fi

# Sync settings page with Patches, Updates tabs
if [ -f "$SRC/app/(dashboard)/dashboard/settings/page.tsx" ]; then
  cp -f "$SRC/app/(dashboard)/dashboard/settings/page.tsx" \
        "$DEST/app/(dashboard)/dashboard/settings/"
  log "Synced settings page with patches and updates tabs"
fi

# Sync all settings components
if [ -d "$SRC/app/(dashboard)/dashboard/settings/components" ]; then
  mkdir -p "$DEST/app/(dashboard)/dashboard/settings/components"
  cp -f "$SRC/app/(dashboard)/dashboard/settings/components/"*.tsx \
        "$DEST/app/(dashboard)/dashboard/settings/components/" 2>/dev/null || true
  log "Synced settings components"
fi

# Sync Sidebar with badge (for PATCHED badge)
if [ -f "$SRC/Sidebar-with-badge.tsx" ]; then
  cp -f "$SRC/Sidebar-with-badge.tsx" "$DEST/shared/components/Sidebar.tsx"
  log "Synced Sidebar with PATCHED badge"
fi

# Sync PatchBadge component
if [ -f "$SRC/ui-patches/components/PatchBadge.tsx" ]; then
  mkdir -p "$DEST/shared/components"
  cp -f "$SRC/ui-patches/components/PatchBadge.tsx" "$DEST/shared/components/"
  log "Synced PatchBadge component"
fi

# Sync OmniRouteUpdater and CLIProxyAPIManager (from src root)
for comp in OmniRouteUpdater CLIProxyAPIManager; do
  if [ -f "$SRC/${comp}.tsx" ]; then
    mkdir -p "$DEST/app/(dashboard)/dashboard/settings/components"
    cp -f "$SRC/${comp}.tsx" "$DEST/app/(dashboard)/dashboard/settings/components/"
    log "Synced ${comp}.tsx"
  fi
done

# Copy wreq-js stub
if [ -f "$SRC/../../patches/wreq-js.stub.ts" ]; then
  mkdir -p "$DEST/open-sse/utils"
  cp -f "$SRC/../../patches/wreq-js.stub.ts" "$DEST/open-sse/utils/"
  log "Synced wreq-js.stub.ts"
fi

log "=== UI patches sync complete ==="
