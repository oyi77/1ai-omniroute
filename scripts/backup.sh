#!/bin/bash
# OmniRoute Database Auto-Backup
BACKUP_DIR="/home/openclaw/.omniroute/db_backups"
DB_PATH="/home/openclaw/.omniroute/storage.sqlite"
TIMESTAMP=$(date +"%Y-%m-%dT%H-%M-%S")
BACKUP_FILE="$BACKUP_DIR/db_${TIMESTAMP}.sqlite"

# Create backup
cp "$DB_PATH" "$BACKUP_FILE"

# Keep only last 48 backups (48 hours)
ls -t "$BACKUP_DIR"/db_*.sqlite | tail -n +49 | xargs rm -f 2>/dev/null

echo "[$(date)] Backup created: $BACKUP_FILE"
