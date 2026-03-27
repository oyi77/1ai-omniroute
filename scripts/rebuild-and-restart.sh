#!/bin/bash
set -e

OMNI_SRC="/home/openclaw/omniroute-src"
PM2_NAME="omniroute"
BUILD_LOG="/home/openclaw/.omniroute/patches/build.log"
PATCH_LOG="/home/openclaw/.omniroute/patches/install.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$BUILD_LOG"
}

log "=== Starting rebuild and restart ==="

# Navigate to omniroute-src
cd "$OMNI_SRC"

# Setup node version
export HOME=/home/openclaw
export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)"
fnm use 22

log "Building omniroute..."
npm run build >> "$BUILD_LOG" 2>&1

if [ $? -eq 0 ]; then
  log "Build successful"
else
  log "Build failed - check $BUILD_LOG"
  exit 1
fi

log "Restarting PM2 service: $PM2_NAME"
# Inject the patch hooks via NODE_OPTIONS --require
# This ensures patches are loaded without modifying the source code.
PATCH_HOOKS="/home/openclaw/.omniroute/patches/000-patch-hooks.cjs"

if [ -f "$PATCH_HOOKS" ]; then
  log "Injecting patch orchestrator into PM2..."
  # Use pm2 set to persist the environment variable
  pm2 set "env:NODE_OPTIONS" "--require $PATCH_HOOKS"
  pm2 restart "$PM2_NAME" --update-env
else
  log "WARNING: Patch orchestrator not found at $PATCH_HOOKS"
  pm2 restart "$PM2_NAME"
fi

log "Waiting for service to start..."
sleep 5

# Check if service is running
if pm2 describe "$PM2_NAME" | grep -q "status.*online"; then
  log "Service restarted successfully"
else
  log "WARNING: Service may not be running properly"
fi

log "=== Rebuild and restart complete ==="
