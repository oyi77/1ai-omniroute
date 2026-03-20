#!/usr/bin/env python3
"""
1ai-omniroute Batch Provider Adder
===================================
Reads API keys from api-keys.json and adds them to OmniRoute's SQLite database.

Usage:
  ./batch-add-providers.sh                    # Add all providers from api-keys.json
  ./batch-add-providers.sh --list             # List current providers
  ./batch-add-providers.sh --dry-run          # Show what would be added
  ./batch-add-providers.sh --provider opencode-zen  # Add single provider
"""

import sys
import os
import json
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime

# Configuration
SCRIPT_DIR = Path(__file__).parent
CONFIG_FILE = SCRIPT_DIR.parent / "api-keys.json"
DB_PATH = Path.home() / ".omniroute" / "storage.sqlite"

def get_db_connection():
    """Connect to OmniRoute SQLite database."""
    if not DB_PATH.exists():
        print(f"ERROR: Database not found at {DB_PATH}")
        print("       Make sure OmniRoute is installed and has been run at least once.")
        sys.exit(1)
    return sqlite3.connect(str(DB_PATH))

def load_config():
    """Load API keys from JSON config file."""
    if not CONFIG_FILE.exists():
        print(f"ERROR: Config file not found: {CONFIG_FILE}")
        print("       Copy api-keys.json.example to api-keys.json and fill in your keys.")
        sys.exit(1)
    
    try:
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: Invalid JSON in {CONFIG_FILE}: {e}")
        sys.exit(1)

def list_providers():
    """List all providers in the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT provider, name, api_key, is_active, priority, default_model
        FROM provider_connections
        ORDER BY priority, provider
    """)
    
    providers = cursor.fetchall()
    conn.close()
    
    if not providers:
        print("No providers configured.")
        return
    
    print(f"\n{'Provider':<20} {'Name':<25} {'API Key':<20} {'Active':<8} {'Priority':<10} {'Model'}")
    print("-" * 100)
    
    for provider, name, api_key, is_active, priority, model in providers:
        api_key_display = f"{api_key[:8]}..." if api_key and len(api_key) > 8 else "None"
        active = "✅" if is_active else "❌"
        print(f"{provider:<20} {name or '':<25} {api_key_display:<20} {active:<8} {priority or 0:<10} {model or ''}")

def add_provider(provider_id, config, dry_run=False):
    """Add a single provider to the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Check if provider already exists
    cursor.execute("SELECT id, api_key FROM provider_connections WHERE provider = ?", (provider_id,))
    existing = cursor.fetchone()
    
    api_key = config.get("api_key", "")
    name = config.get("name", provider_id)
    priority = config.get("priority", 100)
    default_model = config.get("default_model", "")
    
    if not api_key or api_key.startswith("YOUR_"):
        print(f"  ⚠️  Skipping {provider_id}: API key not configured")
        conn.close()
        return False
    
    if existing:
        existing_id, existing_key = existing
        if existing_key == api_key:
            print(f"  ✅ {provider_id}: Already configured with same API key")
            conn.close()
            return True
        else:
            if dry_run:
                print(f"  🔄 {provider_id}: Would update API key")
                conn.close()
                return True
            else:
                cursor.execute("""
                    UPDATE provider_connections 
                    SET api_key = ?, name = ?, priority = ?, default_model = ?, 
                        updated_at = ?, is_active = 1, test_status = NULL, error_code = NULL
                    WHERE provider = ?
                """, (api_key, name, priority, default_model, datetime.now().isoformat(), provider_id))
                print(f"  ✅ {provider_id}: Updated API key")
    else:
        if dry_run:
            print(f"  ➕ {provider_id}: Would add new provider")
            conn.close()
            return True
        else:
            new_id = str(uuid.uuid4())
            cursor.execute("""
                INSERT INTO provider_connections 
                (id, provider, name, api_key, priority, default_model, is_active, 
                 created_at, updated_at, auth_type)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, 'api_key')
            """, (new_id, provider_id, name, api_key, priority, default_model, 
                  datetime.now().isoformat(), datetime.now().isoformat()))
            print(f"  ✅ {provider_id}: Added new provider")
    
    if not dry_run:
        conn.commit()
    
    conn.close()
    return True

def batch_add_providers(dry_run=False, single_provider=None):
    """Batch add providers from config file."""
    config = load_config()
    providers_config = config.get("providers", {})
    
    if not providers_config:
        print("No providers configured in api-keys.json")
        return
    
    print(f"\n{'DRY RUN: ' if dry_run else ''}Processing providers from {CONFIG_FILE}")
    print("=" * 60)
    
    success_count = 0
    skip_count = 0
    
    if single_provider:
        if single_provider in providers_config:
            if add_provider(single_provider, providers_config[single_provider], dry_run):
                success_count += 1
            else:
                skip_count += 1
        else:
            print(f"ERROR: Provider '{single_provider}' not found in config file")
            sys.exit(1)
    else:
        for provider_id, provider_config in providers_config.items():
            if provider_id.startswith("_"):
                continue  # Skip comments
            
            if add_provider(provider_id, provider_config, dry_run):
                success_count += 1
            else:
                skip_count += 1
    
    print("\n" + "=" * 60)
    print(f"{'DRY RUN: ' if dry_run else ''}Completed: {success_count} processed, {skip_count} skipped")
    
    if not dry_run and success_count > 0:
        print("\nTo apply changes, restart OmniRoute:")
        print("  sudo systemctl restart omniroute")

def main():
    mode = "--add"
    dry_run = False
    single_provider = None
    
    for arg in sys.argv[1:]:
        if arg == "--list":
            list_providers()
            return
        elif arg == "--dry-run":
            dry_run = True
        elif arg == "--help" or arg == "-h":
            print(__doc__)
            return
        elif arg.startswith("--provider="):
            single_provider = arg.split("=", 1)[1]
        elif not arg.startswith("-"):
            # Treat as provider name if no flag
            single_provider = arg
    
    batch_add_providers(dry_run=dry_run, single_provider=single_provider)

if __name__ == "__main__":
    main()
