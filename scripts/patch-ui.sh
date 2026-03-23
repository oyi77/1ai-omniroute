#!/usr/bin/env bash
# ============================================================================
# OmniRoute UI Patch Applicator
# ============================================================================
# Applies the patch management UI to OmniRoute, regardless of installation method.
# Supports both npm-installed and git-cloned OmniRoute.
#
# Usage:
#   ./patch-ui.sh --apply    # Apply the UI patches
#   ./patch-ui.sh --revert   # Revert the UI patches
#   ./patch-ui.sh --status   # Show patch status
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_SOURCE="${SCRIPT_DIR}/src"
LOG_PREFIX="[patch-ui] $(date '+%Y-%m-%d %H:%M:%S')"

for arg in "$@"; do
  case $arg in
    --apply) ACTION="apply" ;;
    --revert) ACTION="revert" ;;
    --status) ACTION="status" ;;
  esac
done

ACTION="${ACTION:-status}"

log() { echo "$LOG_PREFIX $*"; }
die() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

detect_install_method() {
  if command -v omniroute &>/dev/null; then
    OMNIROUTE_PATH="$(command -v omniroute)"
    if [[ -L "$OMNIROUTE_PATH" ]]; then
      REAL_PATH="$(readlink -f "$OMNIROUTE_PATH")"
      if [[ "$REAL_PATH" == *".npm-global"* ]]; then
        echo "npm"
        return
      fi
    fi
  fi
  
  if [[ -d "/home/openclaw/.npm-global/lib/node_modules/omniroute" ]]; then
    echo "npm"
    return
  fi
  
  if [[ -d "/home/openclaw/omniroute" ]]; then
    echo "git"
    return
  fi
  
  echo "unknown"
}

get_npm_path() {
  if [[ -d "/home/openclaw/.npm-global/lib/node_modules/omniroute" ]]; then
    echo "/home/openclaw/.npm-global/lib/node_modules/omniroute"
    return
  fi
  
  if command -v npm &>/dev/null; then
    NPM_PREFIX="$(npm config get prefix 2>/dev/null || echo "/usr/local")"
    if [[ -d "${NPM_PREFIX}/lib/node_modules/omniroute" ]]; then
      echo "${NPM_PREFIX}/lib/node_modules/omniroute"
      return
    fi
  fi
  
  die "Could not find npm-installed OmniRoute"
}

apply_to_npm() {
  local NPM_PATH="$1"
  local SETTINGS_DIR="${NPM_PATH}/app/src/app/(dashboard)/dashboard/settings"
  local COMPONENTS_DIR="${SETTINGS_DIR}/components"
  
  log "Applying UI patches to npm-installed OmniRoute at ${NPM_PATH}"
  
  mkdir -p "${COMPONENTS_DIR}"
  
  if [[ -f "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/components/PatchesTab.tsx" ]]; then
    cp "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/components/PatchesTab.tsx" "${COMPONENTS_DIR}/PatchesTab.tsx"
    log "Copied PatchesTab.tsx"
  fi
  
  if [[ -f "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/page.tsx" ]]; then
    cp "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/page.tsx" "${SETTINGS_DIR}/page.tsx"
    log "Copied settings/page.tsx with PATCHED badge"
  fi
  
  log "UI patches applied. Restart OmniRoute to see changes."
}

apply_to_git() {
  local GIT_PATH="$1"
  local SETTINGS_DIR="${GIT_PATH}/app/src/app/(dashboard)/dashboard/settings"
  local COMPONENTS_DIR="${SETTINGS_DIR}/components"
  
  log "Applying UI patches to git-cloned OmniRoute at ${GIT_PATH}"
  
  mkdir -p "${COMPONENTS_DIR}"
  
  if [[ -f "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/components/PatchesTab.tsx" ]]; then
    cp "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/components/PatchesTab.tsx" "${COMPONENTS_DIR}/PatchesTab.tsx"
    log "Copied PatchesTab.tsx"
  fi
  
  if [[ -f "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/page.tsx" ]]; then
    cp "${PATCH_SOURCE}/app/(dashboard)/dashboard/settings/page.tsx" "${SETTINGS_DIR}/page.tsx"
    log "Copied settings/page.tsx with PATCHED badge"
  fi
  
  log "UI patches applied. Rebuild OmniRoute to see changes."
}

revert_from_npm() {
  local NPM_PATH="$1"
  local SETTINGS_DIR="${NPM_PATH}/app/src/app/(dashboard)/dashboard/settings"
  local COMPONENTS_DIR="${SETTINGS_DIR}/components"
  
  log "Reverting UI patches from npm-installed OmniRoute"
  
  if [[ -f "${COMPONENTS_DIR}/PatchesTab.tsx" ]]; then
    rm "${COMPONENTS_DIR}/PatchesTab.tsx"
    log "Removed PatchesTab.tsx"
  fi
  
  log "Revert complete. Restart OmniRoute."
}

revert_from_git() {
  local GIT_PATH="$1"
  local SETTINGS_DIR="${GIT_PATH}/app/src/app/(dashboard)/dashboard/settings"
  local COMPONENTS_DIR="${SETTINGS_DIR}/components"
  
  log "Reverting UI patches from git-cloned OmniRoute"
  
  if [[ -f "${COMPONENTS_DIR}/PatchesTab.tsx" ]]; then
    rm "${COMPONENTS_DIR}/PatchesTab.tsx"
    log "Removed PatchesTab.tsx"
  fi
  
  log "Revert complete. Rebuild OmniRoute."
}

check_status_npm() {
  local NPM_PATH="$1"
  local COMPONENTS_DIR="${NPM_PATH}/app/src/app/(dashboard)/dashboard/settings/components"
  
  if [[ -f "${COMPONENTS_DIR}/PatchesTab.tsx" ]]; then
    echo "  ✓ PatchesTab.tsx - APPLIED"
  else
    echo "  ✗ PatchesTab.tsx - NOT APPLIED"
  fi
}

check_status_git() {
  local GIT_PATH="$1"
  local COMPONENTS_DIR="${GIT_PATH}/app/src/app/(dashboard)/dashboard/settings/components"
  
  if [[ -f "${COMPONENTS_DIR}/PatchesTab.tsx" ]]; then
    echo "  ✓ PatchesTab.tsx - APPLIED"
  else
    echo "  ✗ PatchesTab.tsx - NOT APPLIED"
  fi
}

main() {
  log "Detecting OmniRoute installation method..."
  INSTALL_METHOD=$(detect_install_method)
  log "Found: ${INSTALL_METHOD}"
  
  case "$INSTALL_METHOD" in
    npm)
      NPM_PATH=$(get_npm_path)
      case "$ACTION" in
        apply)
          apply_to_npm "$NPM_PATH"
          ;;
        revert)
          revert_from_npm "$NPM_PATH"
          ;;
        status)
          log "Checking patch status for npm installation..."
          check_status_npm "$NPM_PATH"
          ;;
      esac
      ;;
    git)
      GIT_PATH="/home/openclaw/omniroute"
      case "$ACTION" in
        apply)
          apply_to_git "$GIT_PATH"
          ;;
        revert)
          revert_from_git "$GIT_PATH"
          ;;
        status)
          log "Checking patch status for git installation..."
          check_status_git "$GIT_PATH"
          ;;
      esac
      ;;
    *)
      die "Could not detect OmniRoute installation method. Please install OmniRoute first."
      ;;
  esac
  
  log "Done."
}

main "$@"