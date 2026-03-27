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

# Sync PatchesTab UI component
if [ -f "$SRC/app/(dashboard)/dashboard/settings/components/PatchesTab.tsx" ]; then
  mkdir -p "$DEST/app/(dashboard)/dashboard/settings/components"
  cp -f "$SRC/app/(dashboard)/dashboard/settings/components/PatchesTab.tsx" \
        "$DEST/app/(dashboard)/dashboard/settings/components/"
  log "Synced PatchesTab.tsx"
fi

# Sync settings page if it has patches tab
if [ -f "$SRC/app/(dashboard)/dashboard/settings/page.tsx" ]; then
  if grep -q "PatchesTab" "$SRC/app/(dashboard)/dashboard/settings/page.tsx"; then
    cp -f "$SRC/app/(dashboard)/dashboard/settings/page.tsx" \
          "$DEST/app/(dashboard)/dashboard/settings/"
    log "Synced settings page with patches tab"
  fi
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
