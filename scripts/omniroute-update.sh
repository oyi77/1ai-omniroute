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
    MIN_VERSION="2.7.8"
    LATEST="$(npm show omniroute version 2>/dev/null || echo "$MIN_VERSION")"
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

# ── 2c. CRITICAL: Rebuild better-sqlite3 for OmniRoute's Node.js version ────────
# OmniRoute runs on Node 22 (ABI v127) but npm in PATH may be Node 25 (ABI v141).
# better-sqlite3 is a native addon compiled for a specific ABI — if mismatched,
# ALL chat completions return HTTP 500. Must use Node 22's npm to rebuild.
OMNIROUTE_APP="/home/openclaw/.npm-global/lib/node_modules/omniroute/app"
NODE22="/usr/bin/node"
NODE22_NPM="$NODE22"

if [[ -d "$OMNIROUTE_APP" ]] && [[ -f "$OMNIROUTE_APP/node_modules/better-sqlite3/package.json" ]]; then
  if [[ "$DRY_RUN" == true ]]; then
    log "DRY RUN: would run 'npm rebuild better-sqlite3' using Node 22"
  else
    log "Rebuilding better-sqlite3 for Node 22 ABI (fixes HTTP 500 errors)..."
    if cd "$OMNIROUTE_APP" && "$NODE22_NPM" rebuild better-sqlite3 --build-from-source 2>&1 | tail -5; then
      log "better-sqlite3 rebuilt successfully for Node 22 ✓"
    else
      log "WARNING: better-sqlite3 rebuild failed — server may crash with HTTP 500"
    fi
  fi
else
  log "WARNING: OmniRoute app directory not found at $OMNIROUTE_APP — skipping native module rebuild"
fi

# ── 2b. Verify patch system is active ───────────────────────────────────────
PATCH_DIR="$SCRIPT_DIR/patches"

if [[ "$DRY_RUN" == false ]]; then
  if [[ -d "$PATCH_DIR" ]]; then
    PATCH_COUNT=$(find "$PATCH_DIR" -name "*.cjs" | wc -l)
    log "Found $PATCH_COUNT modular patch(es) in $PATCH_DIR"
  else
    log "WARNING: No patches directory found at $PATCH_DIR"
  fi
fi

# ── 3. Re-apply provider catalog patch ──────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  log "DRY RUN: would run '$PATCH_SCRIPT --check'"
else
  log "Re-applying provider catalog patch..."
  if python3 "$PATCH_SCRIPT"; then
    log "Provider catalog patch applied successfully"
  else
    die "Provider catalog patch failed"
  fi
fi

# ── 3b. Ensure Antigravity client_secret in systemd service ──────────────────
# IMPORTANT: Read secret from environment variable, not hardcoded!
# Set ANTIGRAVITY_OAUTH_CLIENT_SECRET in your environment before running this script
# Example: export ANTIGRAVITY_OAUTH_CLIENT_SECRET="your-secret-here"
SERVICE_FILE="/etc/systemd/system/omniroute.service"
if [[ "$DRY_RUN" == false ]]; then
  if [[ -f "$SERVICE_FILE" ]]; then
    ANTIGRAVITY_SECRET="${ANTIGRAVITY_OAUTH_CLIENT_SECRET:-}"
    if [[ -n "$ANTIGRAVITY_SECRET" ]]; then
      if grep -q "ANTIGRAVITY_OAUTH_CLIENT_SECRET=$ANTIGRAVITY_SECRET" "$SERVICE_FILE" 2>/dev/null; then
        log "Antigravity secret already configured in service"
      else
        log "Updating Antigravity secret in systemd service..."
        # Remove old line and add new one
        sudo sed -i '/ANTIGRAVITY_OAUTH_CLIENT_SECRET/d' "$SERVICE_FILE"
        sudo sed -i "/Environment=PATH=/a Environment=ANTIGRAVITY_OAUTH_CLIENT_SECRET=$ANTIGRAVITY_SECRET" "$SERVICE_FILE"
        sudo systemctl daemon-reload
        log "Antigravity secret updated in service"
      fi
    else
      log "WARNING: ANTIGRAVITY_OAUTH_CLIENT_SECRET not set in environment"
    fi
  fi
fi

# ── 4. Restart systemd service ────────────────────────────────────────────────
if [[ "$DRY_RUN" == true ]]; then
  log "DRY RUN: would run 'sudo systemctl restart omniroute'"
else
  log "Restarting omniroute service..."
  if sudo systemctl restart omniroute 2>/dev/null; then
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
  sleep 3

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
