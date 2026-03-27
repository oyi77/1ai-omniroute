#!/usr/bin/env bash
# =============================================================================
# 1ai-omniroute Update Script
# =============================================================================
# Updates patches from the 1ai-omniroute repo and restarts OmniRoute.
#
# Flow:
#   1. Disable all active patches (backup)
#   2. git pull
#   3. Copy fresh patches
#   4. Restart OmniRoute (PM2)
#   5. Log everything
#
# Usage:
#   bash ~/.omniroute/update.sh
#   bash ~/1ai-omniroute/scripts/update.sh
# =============================================================================

set -euo pipefail

REPO_DIR="${HOME}/1ai-omniroute"
PATCHES_DIR="${HOME}/.omniroute/patches"
LOG_FILE="${HOME}/.omniroute/patches/update.log"
TIMESTAMP="$(date '+%Y-%m-%d %H:%M:%S')"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${BLUE}[update]${NC} $*" | tee -a "$LOG_FILE"; }
success() { echo -e "${GREEN}[update]${NC} ✅ $*" | tee -a "$LOG_FILE"; }
warn()    { echo -e "${YELLOW}[update]${NC} ⚠️  $*" | tee -a "$LOG_FILE"; }
error()   { echo -e "${RED}[update]${NC} ❌ $*" | tee -a "$LOG_FILE"; }

# ─── Start ───────────────────────────────────────────────────────────────────

echo "" | tee -a "$LOG_FILE"
echo "=============================================" | tee -a "$LOG_FILE"
log "=== 1ai-omniroute Update started: ${TIMESTAMP} ==="
echo "=============================================" | tee -a "$LOG_FILE"

# ─── Step 1: Validate repo ───────────────────────────────────────────────────

if [ ! -d "$REPO_DIR/.git" ]; then
  error "Repo not found at $REPO_DIR"
  error "Clone it first: git clone https://github.com/oyi77/1ai-omniroute.git ~/1ai-omniroute"
  exit 1
fi

if [ ! -d "$PATCHES_DIR" ]; then
  warn "Patches dir not found, creating: $PATCHES_DIR"
  mkdir -p "$PATCHES_DIR"
fi

# ─── Step 2: Disable active patches (backup) ─────────────────────────────────

log "Step 1/5: Disabling active patches..."
DISABLED_COUNT=0
SKIPPED_COUNT=0

for patch in "${PATCHES_DIR}"/*.cjs; do
  [ -f "$patch" ] || continue
  filename="$(basename "$patch")"

  # Skip files already disabled/archived
  if [[ "$filename" == *.disabled ]] || [[ "$filename" == *.archived ]]; then
    log "  ⏭ Skip (already disabled): $filename"
    ((SKIPPED_COUNT++)) || true
    continue
  fi

  mv "$patch" "${patch}.bak"
  log "  🔒 Disabled: $filename"
  ((DISABLED_COUNT++)) || true
done

success "Disabled $DISABLED_COUNT patches (skipped $SKIPPED_COUNT)"

# ─── Step 3: Git pull ─────────────────────────────────────────────────────────

log "Step 2/5: Pulling latest from origin/master..."
cd "$REPO_DIR"

# Stash any local changes before pull
if git diff --quiet && git diff --cached --quiet; then
  log "  No local changes, pulling cleanly"
else
  warn "  Local changes detected — stashing before pull"
  git stash save "update-script-auto-stash-${TIMESTAMP}" >> "$LOG_FILE" 2>&1 || true
fi

BEFORE_HASH="$(git rev-parse HEAD)"
git pull origin master >> "$LOG_FILE" 2>&1
AFTER_HASH="$(git rev-parse HEAD)"

if [ "$BEFORE_HASH" = "$AFTER_HASH" ]; then
  log "  Already up to date (${AFTER_HASH:0:8})"
else
  success "Updated: ${BEFORE_HASH:0:8} → ${AFTER_HASH:0:8}"
  # Show what changed
  git log --oneline "${BEFORE_HASH}..${AFTER_HASH}" | while read -r line; do
    log "  📝 $line"
  done
fi

# ─── Step 4: Copy fresh patches ──────────────────────────────────────────────

log "Step 3/5: Installing fresh patches..."

# Remove .bak files (we have fresh copies from git)
for bak in "${PATCHES_DIR}"/*.cjs.bak; do
  [ -f "$bak" ] || continue
  rm -f "$bak"
  log "  🗑 Removed stale backup: $(basename "$bak")"
done

# Copy all .cjs patches from repo
COPIED=0
if [ -d "${REPO_DIR}/patches" ]; then
  for patch in "${REPO_DIR}/patches"/*.cjs; do
    [ -f "$patch" ] || continue
    filename="$(basename "$patch")"
    cp "$patch" "${PATCHES_DIR}/${filename}"
    log "  📦 Installed: $filename"
    ((COPIED++)) || true
  done
else
  warn "No patches/ directory in repo"
fi

# Copy scripts too
if [ -d "${REPO_DIR}/scripts" ]; then
  for script in "${REPO_DIR}/scripts"/*.sh; do
    [ -f "$script" ] || continue
    scriptname="$(basename "$script")"
    dest="${HOME}/.omniroute/${scriptname}"
    cp "$script" "$dest"
    chmod +x "$dest"
    log "  📜 Installed script: $scriptname"
  done
fi

success "Installed $COPIED patches"

# ─── Step 5: Restart OmniRoute ───────────────────────────────────────────────

log "Step 4/5: Restarting OmniRoute..."

# Setup Node env
export HOME="${HOME}"
export PATH="${HOME}/.local/share/fnm:${PATH}"
eval "$(fnm env 2>/dev/null)" 2>/dev/null || true
fnm use 22 2>/dev/null || true

PATCH_HOOKS="${PATCHES_DIR}/000-patch-hooks.cjs"
RESTARTED=false

if command -v pm2 &>/dev/null; then
  if pm2 list 2>/dev/null | grep -q "omniroute"; then
    if [ -f "$PATCH_HOOKS" ]; then
      log "  Injecting patch hooks into PM2 env..."
      pm2 set "env:NODE_OPTIONS" "--require $PATCH_HOOKS" 2>/dev/null || true
    fi
    pm2 restart omniroute --update-env >> "$LOG_FILE" 2>&1 && RESTARTED=true
    success "OmniRoute restarted via PM2"
  else
    warn "OmniRoute not found in PM2 process list"
  fi
fi

if [ "$RESTARTED" = false ]; then
  # Try systemctl
  if systemctl is-active --quiet omniroute 2>/dev/null; then
    sudo systemctl restart omniroute 2>/dev/null && RESTARTED=true
    success "OmniRoute restarted via systemctl"
  fi
fi

if [ "$RESTARTED" = false ]; then
  warn "Could not auto-restart OmniRoute — restart manually"
  warn "  pm2 restart omniroute   or"
  warn "  systemctl restart omniroute"
fi

# ─── Step 6: Verify ──────────────────────────────────────────────────────────

log "Step 5/5: Verifying..."

sleep 3
if curl -s "http://localhost:20128/v1/models" &>/dev/null; then
  success "OmniRoute API responding ✅"
else
  warn "OmniRoute API not responding yet — may still be starting"
fi

if curl -s "http://localhost:20130/health" &>/dev/null; then
  success "Browser LLM Bridge responding ✅"
else
  warn "Browser LLM Bridge not responding — will start on next OmniRoute restart"
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo "" | tee -a "$LOG_FILE"
echo "=============================================" | tee -a "$LOG_FILE"
success "Update complete! ($(date '+%H:%M:%S'))"
echo "  Patches installed: $COPIED"
echo "  Commit: ${AFTER_HASH:0:8}"
echo "  Log: $LOG_FILE"
echo "=============================================" | tee -a "$LOG_FILE"
