#!/bin/bash
LOG_FILE="/home/openclaw/.omniroute/auto-update.log"
REPO_DIR="/home/openclaw/omniroute-src"
PID_FILE="/tmp/omniroute-update.pid"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        log "Update already running (PID: $PID)"
        exit 0
    fi
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

log "=== Starting OmniRoute auto-update check ==="

cd "$REPO_DIR" || exit 1

export PATH="$HOME/.local/share/fnm:$PATH"
eval "$(fnm env)"
fnm use 22

git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "Already up to date (commit: ${LOCAL:0:8})"
    exit 0
fi

log "Update available: ${LOCAL:0:8} -> ${REMOTE:0:8}"

BACKUP_DIR="/home/openclaw/.omniroute/db_backups/pre-update-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp /home/openclaw/.config/omniroute/storage.sqlite* "$BACKUP_DIR/" 2>/dev/null
cp /home/openclaw/.omniroute/storage.sqlite* "$BACKUP_DIR/" 2>/dev/null
log "Database backed up to: $BACKUP_DIR"

git pull origin main
npm install
npm rebuild better-sqlite3
npm run build

sudo systemctl restart omniroute

sleep 5
if curl -s http://localhost:20128/api/system/version > /dev/null 2>&1; then
    VERSION=$(curl -s http://localhost:20128/api/system/version | grep -o '"current":"[^"]*"' | cut -d'"' -f4)
    log "Update successful! Running version: $VERSION"
else
    log "ERROR: Service not responding after update"
    exit 1
fi

log "=== Auto-update complete ==="
