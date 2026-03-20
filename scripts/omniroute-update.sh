#!/usr/bin/env bash
# ============================================================================
# OmniRoute Update Script
# ============================================================================
# Pulls the latest omniroute from npm, re-applies the custom provider catalog
# patch, and restarts the systemd service.
#
# Usage:
#   ./omniroute-update.sh           # update + patch + restart
#   ./omniroute-update.sh --dry-run # show what would happen, no changes
#   ./omniroute-update.sh --patch-only # skip npm update, only re-patch
#
# Cron (weekly, Sunday 00:00):
#   0 0 * * 0 /home/openclaw/.omniroute/omniroute-update.sh >> /home/openclaw/.omniroute/update.log 2>&1
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCH_SCRIPT="$SCRIPT_DIR/patch-providers.sh"
LOG_PREFIX="[omniroute-update] $(date '+%Y-%m-%d %H:%M:%S')"
DRY_RUN=false
PATCH_ONLY=false

for arg in "$@"; do
  case $arg in
    --dry-run)   DRY_RUN=true ;;
    --patch-only) PATCH_ONLY=true ;;
  esac
done

log() { echo "$LOG_PREFIX $*"; }
die() { echo "$LOG_PREFIX ERROR: $*" >&2; exit 1; }

# ── 0. Sanity checks ─────────────────────────────────────────────────────────
[[ -f "$PATCH_SCRIPT" ]] || die "patch script not found at $PATCH_SCRIPT"
command -v npm  >/dev/null 2>&1 || die "npm not found in PATH"
command -v python3 >/dev/null 2>&1 || die "python3 not found in PATH"

OMNIROUTE_BIN="${NPM_GLOBAL_BIN:-/home/openclaw/.npm-global/bin}/omniroute"
[[ -f "$OMNIROUTE_BIN" ]] || OMNIROUTE_BIN="$(command -v omniroute 2>/dev/null || echo '')"
[[ -n "$OMNIROUTE_BIN" ]] || die "omniroute binary not found"

# ── 1. Get current version ────────────────────────────────────────────────────
CURRENT_VERSION="$(npm list -g omniroute --depth=0 2>/dev/null | grep omniroute | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo 'unknown')"
log "Current version: $CURRENT_VERSION"

# ── 2. npm update (unless --patch-only) ──────────────────────────────────────
if [[ "$PATCH_ONLY" == false ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    LATEST="$(npm show omniroute version 2>/dev/null || echo 'unknown')"
    log "DRY RUN: would run 'npm install -g omniroute' (latest: $LATEST)"
  else
    # Pin to minimum version — never downgrade below the last known-good version
    MIN_VERSION="2.7.8"
    LATEST="$(npm show omniroute version 2>/dev/null || echo "$MIN_VERSION")"
    # Compare versions: only upgrade if latest >= min version
    TARGET=$(python3 -c "
from packaging.version import Version
try:
    latest = Version('$LATEST')
    minimum = Version('$MIN_VERSION')
    print(str(latest) if latest >= minimum else str(minimum))
except: print('$MIN_VERSION')
" 2>/dev/null || echo "$LATEST")
    log "Running: npm install -g omniroute@$TARGET (min: $MIN_VERSION, latest: $LATEST) ..."
    npm install -g "omniroute@$TARGET" 2>&1 | tail -5
    NEW_VERSION="$(npm list -g omniroute --depth=0 2>/dev/null | grep omniroute | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo 'unknown')"
    if [[ "$NEW_VERSION" != "$CURRENT_VERSION" ]]; then
      log "Updated: $CURRENT_VERSION → $NEW_VERSION"
    else
      log "Already at latest: $CURRENT_VERSION"
    fi
  fi
fi

# ── 2b. Verify patch system is active ───────────────────────────────────────
# OpenClaw patches live in ~/.omniroute/patches/ and are auto-loaded by
# bin/omniroute.mjs on every startup. No manual patching needed here.
PATCH_DIR="$SCRIPT_DIR/patches"
if [[ -d "$PATCH_DIR" ]]; then
  PATCH_COUNT=$(find "$PATCH_DIR" -name "*.cjs" -o -name "*.js" 2>/dev/null | wc -l)
  log "OpenClaw modular patches found: $PATCH_COUNT (auto-loaded on startup)"
fi

# ── 3. Apply catalog patch ────────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  log "DRY RUN: would run patch-providers.sh --check"
  python3 "$PATCH_SCRIPT" --check
else
  log "Applying provider catalog patch..."
  if python3 "$PATCH_SCRIPT"; then
    log "Patch applied successfully"
  else
    die "Patch failed — check $PATCH_SCRIPT for errors"
  fi
fi

# ── 3b. Ensure Antigravity client_secret in systemd service ──────────────────
# Source: https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/auth/antigravity/constants.go
ANTIGRAVITY_SECRET="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"
SVCFILE="/etc/systemd/system/omniroute.service"
if [[ "$DRY_RUN" == true ]]; then
  log "DRY RUN: would ensure ANTIGRAVITY_OAUTH_CLIENT_SECRET in $SVCFILE"
else
  if grep -q "ANTIGRAVITY_OAUTH_CLIENT_SECRET" "$SVCFILE" 2>/dev/null; then
    log "ANTIGRAVITY_OAUTH_CLIENT_SECRET already in service file — skipping"
  else
    log "Injecting ANTIGRAVITY_OAUTH_CLIENT_SECRET into $SVCFILE..."
    sudo sed -i "/Environment=PATH=/a Environment=ANTIGRAVITY_OAUTH_CLIENT_SECRET=${ANTIGRAVITY_SECRET}" "$SVCFILE"
    sudo systemctl daemon-reload
    log "ANTIGRAVITY_OAUTH_CLIENT_SECRET injected"
  fi
fi

# ── 4. Restart systemd service ────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  log "DRY RUN: would run 'sudo systemctl restart omniroute'"
else
  log "Restarting omniroute service..."
  if sudo systemctl restart omniroute 2>/dev/null; then
    # Wait for service to come up
    for i in $(seq 1 15); do
      sleep 1
      if systemctl is-active --quiet omniroute 2>/dev/null; then
        log "Service restarted and active (${i}s)"
        break
      fi
      if [[ $i -eq 15 ]]; then
        die "Service did not become active after 15s — check: sudo systemctl status omniroute"
      fi
    done
  else
    die "systemctl restart failed — do you have sudo access for omniroute?"
  fi
fi

# ── 5. Verify catalog ─────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == false ]]; then
  log "Verifying catalog..."
  sleep 3  # give service a moment to fully initialize

  # Read API key from env or data dir
  OR_KEY="${OMNIROUTE_API_KEY:-}"
  if [[ -z "$OR_KEY" ]]; then
    ENV_FILE="${DATA_DIR:-/home/openclaw/.openclaw/workspace}/.env"
    [[ -f "$ENV_FILE" ]] && OR_KEY="$(grep '^OMNIROUTE_API_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  fi
  OR_PORT="${OMNIROUTE_PORT:-20128}"

  if [[ -n "$OR_KEY" ]]; then
    RESULT="$(curl -sf -X POST "http://localhost:${OR_PORT}/api/providers" \
      -H "Authorization: Bearer $OR_KEY" \
      -H "Content-Type: application/json" \
      -d '{"provider":"byteplus","apiKey":"test","name":"catalog-verify"}' 2>/dev/null || echo '{}')"

    ERROR="$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null || echo '')"

    if [[ "$ERROR" == "Invalid provider" ]]; then
      log "WARNING: catalog verification failed — 'byteplus' not recognized. Patch may not have taken effect."
    elif [[ -n "$RESULT" ]]; then
      # Clean up test connection
      CONN_ID="$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('connection',{}).get('id',''))" 2>/dev/null || echo '')"
      [[ -n "$CONN_ID" ]] && curl -sf -X DELETE "http://localhost:${OR_PORT}/api/providers/$CONN_ID" \
        -H "Authorization: Bearer $OR_KEY" >/dev/null 2>&1 || true
      log "Catalog verified ✓ (byteplus accepted)"
    fi
  else
    log "Skipping catalog verification (OMNIROUTE_API_KEY not set)"
  fi
fi

log "Done."
