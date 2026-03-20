#!/usr/bin/env bash
# ============================================================================
# 1ai-omniroute Uninstaller
# ============================================================================
# Removes patches and scripts installed by 1ai-omniroute.
#
# Usage:
#   ./uninstall.sh
# ============================================================================

set -euo pipefail

INSTALL_DIR="${HOME}/.omniroute"
PATCHES_DIR="${INSTALL_DIR}/patches"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[1ai-omniroute]${NC} $*"; }
success() { echo -e "${GREEN}[1ai-omniroute]${NC} ✅ $*"; }
warn() { echo -e "${YELLOW}[1ai-omniroute]${NC} ⚠️  $*"; }

log "Uninstalling 1ai-omniroute patches..."

# Remove patches
if [ -d "${PATCHES_DIR}" ]; then
    log "Removing patches..."
    rm -v "${PATCHES_DIR}/"*.cjs 2>/dev/null || true
    success "Patches removed"
else
    warn "No patches directory found"
fi

# Remove scripts
log "Removing scripts..."
rm -v "${INSTALL_DIR}/patch-providers.sh" 2>/dev/null || true
rm -v "${INSTALL_DIR}/omniroute-update.sh" 2>/dev/null || true
success "Scripts removed"

# Restart OmniRoute service
if systemctl is-active --quiet omniroute 2>/dev/null; then
    log "Restarting OmniRoute service..."
    if sudo systemctl restart omniroute 2>/dev/null; then
        success "OmniRoute service restarted"
    else
        warn "Failed to restart service"
    fi
fi

echo ""
echo "=========================================="
echo -e "${GREEN}✅ 1ai-omniroute uninstalled${NC}"
echo "=========================================="
echo ""
echo "Note: ~/.omniroute/.env and other config files were not removed."
echo "Remove them manually if needed."
echo ""
