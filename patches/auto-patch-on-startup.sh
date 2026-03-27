#!/bin/bash
# Auto-patch on startup
# =====================
# Applies all patches to OmniRoute before it starts.
# Called by the omniroute systemd service ExecStartPre.

PATCH_LOG="/home/openclaw/.omniroute/patches/auto-patch.log"
PATCHES_DIR="/home/openclaw/.omniroute/patches"
OMNI_SRC="/home/openclaw/omniroute-src"
BREW_OMNI="/home/linuxbrew/.linuxbrew/lib/node_modules/omniroute"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$PATCH_LOG"; }

log "=== Starting patch cycle ==="

# Find the actual OmniRoute installation
OMNIROUTE_PATH=""
for p in "$BREW_OMNI" "$HOME/.npm-global/lib/node_modules/omniroute" "$OMNI_SRC"; do
  if [ -d "$p/open-sse/handlers" ]; then
    OMNIROUTE_PATH="$p"
    break
  fi
done

if [ -z "$OMNIROUTE_PATH" ]; then
  log "WARNING: Could not find OmniRoute installation"
  log "Patches will be synced but not applied to source"
  OMNIROUTE_PATH="$OMNI_SRC"
fi

log "OmniRoute path: $OMNIROUTE_PATH"

# Step 1: Apply CLIProxyAPI fallback patch to chatCore.ts
if [ -f "$PATCHES_DIR/cli-proxy-fallback-patch.sh" ]; then
  log "Applying CLIProxyAPI fallback patch..."
  export CHATCORE_PATH="$OMNIROUTE_PATH/open-sse/handlers/chatCore.ts"
  bash "$PATCHES_DIR/cli-proxy-fallback-patch.sh" 2>&1 | tee -a "$PATCH_LOG"
  if [ $? -eq 0 ]; then
    log "CLIProxyAPI fallback patch applied successfully"
  else
    log "WARNING: CLIProxyAPI fallback patch failed"
  fi
else
  log "SKIP: cli-proxy-fallback-patch.sh not found"
fi

# Step 2: Copy runtime patches (.cjs) to omniroute-src/src/patches/
if [ -d "$OMNI_SRC/src/patches" ]; then
  cp "$PATCHES_DIR"/*.cjs "$OMNI_SRC/src/patches/" 2>/dev/null || true
  log "Runtime patches synced to $OMNI_SRC/src/patches/"
fi

# Step 2b: Legacy sync (if patches dir exists in root)
if [ -d "$OMNI_SRC/patches" ]; then
  cp "$PATCHES_DIR"/*.cjs "$OMNI_SRC/patches/" 2>/dev/null || true
  log "Runtime patches synced to legacy $OMNI_SRC/patches/"
fi

# Step 3: Sync patches to homebrew installation if it exists
if [ -d "$BREW_OMNI/patches" ] && [ "$BREW_OMNI" != "$OMNI_SRC" ]; then
  cp "$PATCHES_DIR"/*.cjs "$BREW_OMNI/patches/" 2>/dev/null || true
  log "Runtime patches synced to $BREW_OMNI/patches/"
fi

# Step 4: Sync patched chatCore.ts to standalone build
STANDALONE_HC="$OMNI_SRC/.next/standalone/omniroute-src/open-sse/handlers/chatCore.ts"
SOURCE_HC="$OMNIROUTE_PATH/open-sse/handlers/chatCore.ts"
if [ -f "$STANDALONE_HC" ] && [ -f "$SOURCE_HC" ]; then
  cp "$SOURCE_HC" "$STANDALONE_HC"
  log "Synced chatCore.ts to standalone build"
fi

log "=== Patch cycle complete ==="
