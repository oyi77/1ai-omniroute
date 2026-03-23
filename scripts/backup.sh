#!/bin/bash
set -euo pipefail
BACKUP_DIR="/home/openclaw/.omniroute/db_backups"
DB_PATH="/home/openclaw/.config/omniroute/storage.sqlite"
TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/db_${TIMESTAMP}.sqlite"

[[ -f "$DB_PATH" ]] || { echo "ERROR: DB not found at $DB_PATH"; exit 1; }
SIZE=$(stat -c%s "$DB_PATH" 2>/dev/null || echo 0)
[[ "$SIZE" -gt 1024 ]] || { echo "ERROR: DB seems empty ($SIZE bytes) — aborting backup"; exit 1; }

cp "$DB_PATH" "$BACKUP_FILE"
ls -t "$BACKUP_DIR"/db_*.sqlite | tail -n +49 | xargs rm -f 2>/dev/null

echo "[$(date)] Backup created: $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"
