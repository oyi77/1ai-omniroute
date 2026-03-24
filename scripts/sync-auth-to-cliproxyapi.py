#!/usr/bin/env python3
"""Sync OmniRoute auth tokens to CLIProxyAPI auth files."""
import sqlite3, json, os, time

DB = os.path.expanduser("~/.omniroute/storage.sqlite")
CLI_AUTH_DIR = os.path.expanduser("~/.cli-proxy-api")
CLI_CLIENT_ID = os.environ.get("ANTIGRAVITY_CLIENT_ID", "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com")
CLI_CLIENT_SECRET = os.environ.get("ANTIGRAVITY_CLIENT_SECRET", "")

def convert(conn_row):
    cid, provider, name, atok, rtok, proj_id, is_active = conn_row
    if not rtok or not is_active: return None
    return {"type": provider, "access_token": atok or "", "refresh_token": rtok,
            "expires_in": 3600, "timestamp": int(time.time() * 1000),
            "expired": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + 3600)),
            "email": name or f"{provider}-{cid[:8]}", "project_id": proj_id or "",
            "client_id": CLI_CLIENT_ID, "client_secret": CLI_CLIENT_SECRET,
            "token_uri": "https://oauth2.googleapis.com/token",
            "_filename": f"{provider}_{cid[:8]}.json"}

os.makedirs(CLI_AUTH_DIR, exist_ok=True)
conn = sqlite3.connect(DB)
synced = 0
for row in conn.execute("SELECT id, provider, display_name, access_token, refresh_token, project_id, is_active FROM provider_connections WHERE provider='antigravity' AND is_active=1 AND refresh_token IS NOT NULL AND refresh_token != ''"):
    auth = convert(row)
    if auth:
        fname = auth.pop("_filename")
        with open(os.path.join(CLI_AUTH_DIR, fname), "w") as f: json.dump(auth, f, indent=2)
        synced += 1
for row in conn.execute("SELECT id, provider, display_name, access_token, refresh_token, refresh_token, NULL, is_active FROM provider_connections WHERE provider='claude' AND is_active=1 AND refresh_token IS NOT NULL AND refresh_token != ''"):
    auth = convert(row)
    if auth:
        fname = auth.pop("_filename")
        with open(os.path.join(CLI_AUTH_DIR, fname), "w") as f: json.dump(auth, f, indent=2)
        synced += 1
conn.close()
print(f"Synced {synced} auth files to {CLI_AUTH_DIR}")
