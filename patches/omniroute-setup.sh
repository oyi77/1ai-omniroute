#!/bin/bash
# omniroute-setup.sh - One-click OmniRoute installation with auto-patches
# Usage: bash <(curl -sL https://raw.githubusercontent.com/oyi77/1ai-omniroute/master/patches/omniroute-setup.sh)

set -e

OMNI_DIR="$HOME/.npm-global/lib/node_modules/omniroute/app"
PATCH_DIR="$HOME/.omniroute/patches"
LOG_FILE="$PATCH_DIR/auto-patch.log"

log() {
  echo "[$(date -Iseconds)] $1" | tee -a "$LOG_FILE"
}

echo "=========================================="
echo "  OmniRoute Setup with Auto-Patches"
echo "=========================================="
echo ""

# Step 1: Install/update omniroute
log "Installing OmniRoute..."
npm install -g omniroute 2>/dev/null || npm update -g omniroute

# Step 2: Ensure patch directory exists
mkdir -p "$PATCH_DIR"

# Step 3: Download latest patches from GitHub
if [ -d "$PATCH_DIR/.git" ]; then
  log "Updating patches from GitHub..."
  cd "$PATCH_DIR"
  git pull origin master 2>/dev/null || true
else
  log "Cloning patches from GitHub..."
  git clone https://github.com/oyi77/1ai-omniroute.git /tmp/1ai-omniroute-temp
  cp -r /tmp/1ai-omniroute-temp/patches/* "$PATCH_DIR/"
  rm -rf /tmp/1ai-omniroute-temp
fi

chmod +x "$PATCH_DIR"/*.sh

# Step 4: Apply patches
log "Applying patches..."
bash "$PATCH_DIR/postinstall.sh"

# Step 5: Configure systemd auto-patch
log "Configuring systemd auto-patch..."
SERVICE_FILE="/etc/systemd/system/omniroute.service"
if [ -f "$SERVICE_FILE" ]; then
  if ! grep -q "ExecStartPre" "$SERVICE_FILE"; then
    sudo sed -i 's|ExecStart=|ExecStartPre='"$PATCH_DIR"'/auto-patch-on-startup.sh\nExecStart=|' "$SERVICE_FILE"
    sudo systemctl daemon-reload
    log "✅ systemd auto-patch configured"
  else
    log "⏭️  systemd auto-patch already configured"
  fi
fi

# Step 6: Restart OmniRoute
log "Restarting OmniRoute..."
sudo systemctl restart omniroute

sleep 3

# Step 7: Verify
if curl -s http://localhost:20128/api/monitoring/health | jq -e '.status == "healthy"' 2>/dev/null; then
  log "✅ OmniRoute is healthy!"
else
  log "⚠️  OmniRoute health check failed - check status manually"
fi

echo ""
echo "=========================================="
echo "  Setup Complete!"
echo "=========================================="
echo ""
echo "Patches will now auto-apply on:"
echo "  1. npm install/update (via postinstall.sh)"
echo "  2. Service restart (via ExecStartPre)"
echo ""
echo "To manually trigger patches:"
echo "  bash ~/.omniroute/patches/postinstall.sh"
echo ""
echo "To check status:"
echo "  curl http://localhost:20128/api/monitoring/health | jq '.status'"
