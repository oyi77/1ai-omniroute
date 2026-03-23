#!/bin/bash
# OmniRoute Database Restore Script
# Restores OmniRoute DB from a backup file.
# Usage: ./restore.sh [backup_file]
#   If no backup_file provided, lists available backups and prompts.

set -euo pipefail

BACKUP_DIR="/home/openclaw/.omniroute/db_backups"
DB_PATH="/home/openclaw/.config/omniroute/storage.sqlite"
LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/db_*.sqlite 2>/dev/null | head -1)

restore_backup() {
  local backup_file="$1"
  local size_before=""
  [[ -f "$DB_PATH" ]] && size_before=$(du -sh "$DB_PATH" | cut -f1)

  echo "Restoring from: $backup_file ($(du -sh "$backup_file" | cut -f1))"
  echo "Target: $DB_PATH"
  [[ -n "$size_before" ]] && echo "Current DB size: $size_before"

  cp "$backup_file" "$DB_PATH"

  local size_after=$(du -sh "$DB_PATH" | cut -f1)
  echo "Restored: $size_after"

  local providers=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM provider_connections;" 2>/dev/null || echo "0")
  local combos=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM combos;" 2>/dev/null || echo "0")
  echo "Verification: $providers providers, $combos combos"

  if [[ "$providers" -lt 10 ]]; then
    echo "WARNING: Provider count seems low — verify this is the correct backup"
  fi
}

if [[ $# -ge 1 ]] && [[ -f "$1" ]]; then
  restore_backup "$(realpath "$1")"
else
  echo "Available backups:"
  ls -1t "$BACKUP_DIR"/db_*.sqlite 2>/dev/null | nl
  echo ""
  if [[ -n "$LATEST_BACKUP" ]]; then
    echo "Latest: $LATEST_BACKUP ($(du -sh "$LATEST_BACKUP" | cut -f1))"
    echo ""
    read -rp "Enter backup number to restore (or path): " choice
    if [[ -f "$choice" ]]; then
      restore_backup "$(realpath "$choice")"
    else
      backup_file=$(ls -1t "$BACKUP_DIR"/db_*.sqlite 2>/dev/null | sed -n "${choice}p")
      [[ -n "$backup_file" ]] && restore_backup "$(realpath "$backup_file")" || echo "Invalid selection"
    fi
  else
    echo "No backups found in $BACKUP_DIR"
    exit 1
  fi
fi
