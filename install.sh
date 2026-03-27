#!/usr/bin/env bash
# ============================================================================
# 1ai-omniroute One-Line Installer
# ============================================================================
# Installs patches and scripts for OmniRoute enhancements.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/oyi77/1ai-omniroute/main/install.sh | bash
#
# Or clone and run:
#   git clone https://github.com/oyi77/1ai-omniroute.git
#   cd 1ai-omniroute
#   ./install.sh
# ============================================================================

set -euo pipefail

REPO_URL="https://github.com/oyi77/1ai-omniroute.git"
INSTALL_DIR="${HOME}/.omniroute"
PATCHES_DIR="${INSTALL_DIR}/patches"
BACKUP_DIR="${INSTALL_DIR}/backup-$(date +%Y%m%d-%H%M%S)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${BLUE}[1ai-omniroute]${NC} $*"; }
success() { echo -e "${GREEN}[1ai-omniroute]${NC} ✅ $*"; }
warn() { echo -e "${YELLOW}[1ai-omniroute]${NC} ⚠️  $*"; }
error() { echo -e "${RED}[1ai-omniroute]${NC} ❌ $*"; }
die() { error "$*"; exit 1; }

# ─── Preflight Checks ───────────────────────────────────────────────────────

log "Checking prerequisites..."

# Check if omniroute is installed
if ! command -v omniroute &>/dev/null; then
    die "OmniRoute not found. Install it first: npm install -g omniroute"
fi

OMNIROUTE_VERSION="$(omniroute --version 2>/dev/null || echo 'unknown')"
log "Found OmniRoute ${OMNIROUTE_VERSION}"

# Check if node is installed
if ! command -v node &>/dev/null; then
    die "Node.js not found. Install Node.js 22+ first."
fi

NODE_VERSION="$(node --version)"
log "Found Node.js ${NODE_VERSION}"

# Check if python3 is installed (for provider catalog patcher)
if ! command -v python3 &>/dev/null; then
    warn "Python3 not found. Provider catalog patcher will not work."
    PYTHON_AVAILABLE=false
else
    PYTHON_AVAILABLE=true
    log "Found Python3 $(python3 --version 2>&1 | cut -d' ' -f2)"
fi

# ─── Create Directories ─────────────────────────────────────────────────────

log "Creating directories..."

mkdir -p "${PATCHES_DIR}"

# ─── Backup Existing Patches ────────────────────────────────────────────────

if [ "$(ls -A ${PATCHES_DIR} 2>/dev/null)" ]; then
    log "Backing up existing patches to ${BACKUP_DIR}..."
    mkdir -p "${BACKUP_DIR}"
    cp -r "${PATCHES_DIR}"/* "${BACKUP_DIR}/" 2>/dev/null || true
    success "Backup created"
fi

# ─── Download or Copy Patches ───────────────────────────────────────────────

# Determine if we're running from cloned repo or downloading
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ls "${SCRIPT_DIR}/patches/"*.cjs &>/dev/null 2>&1; then
    # Running from cloned repo (any .cjs patch present)
    log "Installing from local repository..."
    SOURCE_DIR="${SCRIPT_DIR}"
else
    # Download repository
    log "Downloading 1ai-omniroute..."
    TEMP_DIR=$(mktemp -d)
    trap "rm -rf ${TEMP_DIR}" EXIT
    
    if command -v git &>/dev/null; then
        git clone --depth 1 "${REPO_URL}" "${TEMP_DIR}/1ai-omniroute" 2>/dev/null || die "Failed to clone repository"
        SOURCE_DIR="${TEMP_DIR}/1ai-omniroute"
    else
        # Fallback to curl/wget for individual files
        warn "Git not found. Downloading individual files..."
        mkdir -p "${TEMP_DIR}/1ai-omniroute/patches" "${TEMP_DIR}/1ai-omniroute/scripts"
        
        # Download patches
        for patch in antigravity-no-projectid.cjs endpoint-router.cjs; do
            curl -fsSL "https://raw.githubusercontent.com/oyi77/1ai-omniroute/main/patches/${patch}" \
                -o "${TEMP_DIR}/1ai-omniroute/patches/${patch}" 2>/dev/null || warn "Failed to download ${patch}"
        done
        
        # Download scripts
        for script in patch-providers.sh omniroute-update.sh; do
            curl -fsSL "https://raw.githubusercontent.com/oyi77/1ai-omniroute/main/scripts/${script}" \
                -o "${TEMP_DIR}/1ai-omniroute/scripts/${script}" 2>/dev/null || warn "Failed to download ${script}"
        done
        
        SOURCE_DIR="${TEMP_DIR}/1ai-omniroute"
    fi
fi

# ─── Install Patches ────────────────────────────────────────────────────────

log "Installing patches..."

if [ -d "${SOURCE_DIR}/patches" ]; then
    cp -v "${SOURCE_DIR}/patches/"*.cjs "${PATCHES_DIR}/" 2>/dev/null || warn "No patches found"
    success "Patches installed to ${PATCHES_DIR}"
else
    warn "No patches directory found in source"
fi

# ─── Install Scripts ────────────────────────────────────────────────────────

log "Installing scripts..."

if [ -d "${SOURCE_DIR}/scripts" ]; then
    cp -v "${SOURCE_DIR}/scripts/"*.sh "${INSTALL_DIR}/" 2>/dev/null || warn "No .sh scripts found"
    cp -v "${SOURCE_DIR}/scripts/"*.js "${INSTALL_DIR}/" 2>/dev/null || true
    chmod +x "${INSTALL_DIR}/"*.sh 2>/dev/null || true
    success "Scripts installed to ${INSTALL_DIR}"
else
    warn "No scripts directory found in source"
fi

# ─── Start Browser LLM Bridge via PM2 ───────────────────────────────────────

BRIDGE_SERVER="${INSTALL_DIR}/bridge-server.js"
if [ -f "${BRIDGE_SERVER}" ] && command -v pm2 &>/dev/null; then
    log "Setting up Browser LLM Bridge (PM2)..."

    # Find node binary
    NODE_BIN="$(command -v node)"

    if pm2 list 2>/dev/null | grep -q "browser-llm-bridge"; then
        pm2 restart browser-llm-bridge 2>/dev/null || true
        success "Browser LLM Bridge restarted (PM2)"
    else
        pm2 start "${BRIDGE_SERVER}" \
            --name browser-llm-bridge \
            --interpreter "${NODE_BIN}" \
            2>/dev/null && success "Browser LLM Bridge started on port 20130" \
            || warn "Failed to start Bridge via PM2 — start manually: pm2 start ${BRIDGE_SERVER} --name browser-llm-bridge"
        pm2 save 2>/dev/null || true
    fi
else
    [ ! -f "${BRIDGE_SERVER}" ] && warn "bridge-server.js not found — skipping PM2 setup"
    ! command -v pm2 &>/dev/null && warn "PM2 not found — start bridge manually: node ${BRIDGE_SERVER}"
fi

# ─── Apply Provider Catalog Patch ───────────────────────────────────────────

if [ "${PYTHON_AVAILABLE}" = true ] && [ -f "${INSTALL_DIR}/patch-providers.sh" ]; then
    log "Applying provider catalog patch..."
    
    if python3 "${INSTALL_DIR}/patch-providers.sh"; then
        success "Provider catalog patched"
    else
        warn "Provider catalog patch failed (OmniRoute may need to be reinstalled)"
    fi
else
    warn "Skipping provider catalog patch (Python3 or patcher script not available)"
fi

# ─── Verify Installation ────────────────────────────────────────────────────

log "Verifying installation..."

# Count installed patches
PATCH_COUNT=$(find "${PATCHES_DIR}" -name "*.cjs" 2>/dev/null | wc -l)
log "Installed ${PATCH_COUNT} patch(es):"
ls -1 "${PATCHES_DIR}/"*.cjs 2>/dev/null | while read -r patch; do
    echo "  - $(basename ${patch})"
done

# ─── Restart OmniRoute Service (if systemd) ─────────────────────────────────

if systemctl is-active --quiet omniroute 2>/dev/null; then
    log "Restarting OmniRoute service..."
    if sudo systemctl restart omniroute 2>/dev/null; then
        success "OmniRoute service restarted"
    else
        warn "Failed to restart service (may need sudo)"
    fi
else
    warn "OmniRoute service not running or not using systemd"
    log "Restart OmniRoute manually to apply patches"
fi

# ─── Setup Environment Variables ─────────────────────────────────────────────

log "Checking environment configuration..."

ENV_FILE="${HOME}/.omniroute/.env"
ENV_EXAMPLE="${SOURCE_DIR}/.env.example"

if [ ! -f "${ENV_FILE}" ] && [ -f "${ENV_EXAMPLE}" ]; then
    log "Creating .env file from template..."
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    warn "Edit ${ENV_FILE} to add your secrets (ANTIGRAVITY_OAUTH_CLIENT_SECRET, etc.)"
fi

# ─── Summary ────────────────────────────────────────────────────────────────

echo ""
echo "=========================================="
echo -e "${GREEN}✅ 1ai-omniroute installed successfully!${NC}"
echo "=========================================="
echo ""
echo "Installed components:"
echo "  📦 Patches: ${PATCHES_DIR}"
echo "  🔧 Scripts: ${INSTALL_DIR}"
echo ""
echo "Next steps:"
echo "  1. Restart OmniRoute (if not auto-restarted)"
echo "  2. Configure secrets in ~/.omniroute/.env"
echo "  3. Check patches are loaded: omniroute --help"
echo ""
echo "Available endpoint aliases:"
echo "  📷 /v1/dalle, /v1/midjourney → /v1/images/generations"
echo "  🎬 /v1/sora, /v1/runway → /v1/videos/generations"
echo "  👁️  /v1/vision, /v1/analyze → /v1/chat/completions"
echo "  🎤 /v1/transcribe, /v1/tts → /v1/audio/*"
echo ""
# Run patch installation and UI sync
if [ -f "${SOURCE_DIR}/scripts/install-patches.sh" ]; then
    log "Running patch installation and UI sync..."
    bash "${SOURCE_DIR}/scripts/install-patches.sh"
    success "Patches installed and UI synced"
fi

echo ""
echo "For updates:"
echo "  • Quick update: bash ~/.omniroute/update.sh"
echo "  • Or from repo:  bash ~/1ai-omniroute/scripts/update.sh"
echo "  • Auto-update: ~/.omniroute/omniroute-update.sh"
echo "  • Check for updates via UI: https://ai.aitradepulse.com/dashboard/settings?tab=patches"
echo ""
echo "Documentation: https://github.com/oyi77/1ai-omniroute"
echo ""

# ─── Install API Keys Template ─────────────────────────────────────────────

log "Installing API keys template..."

if [ -f "${SOURCE_DIR}/api-keys.json.example" ]; then
    if [ ! -f "${INSTALL_DIR}/api-keys.json" ]; then
        cp -v "${SOURCE_DIR}/api-keys.json.example" "${INSTALL_DIR}/api-keys.json"
        warn "Edit ${INSTALL_DIR}/api-keys.json to add your API keys"
    else
        log "api-keys.json already exists, skipping"
    fi
else
    warn "api-keys.json.example not found in source"
fi
