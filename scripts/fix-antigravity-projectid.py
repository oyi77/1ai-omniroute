#!/usr/bin/env python3
"""Fix antigravity 403 by onboarding accounts with projectId via onboardUser."""
import sqlite3, requests, json, time, sys, os

DB = os.path.expanduser("~/.omniroute/storage.sqlite")
CLIENT_ID = os.environ.get("ANTIGRAVITY_CLIENT_ID", "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com")
CLIENT_SECRET = os.environ.get("ANTIGRAVITY_CLIENT_SECRET", "")
TOKEN_URL = "https://oauth2.googleapis.com/token"
ONBOARD_URL = "https://cloudcode-pa.googleapis.com/v1internal:onboardUser"

def refresh_token(refresh_tok):
    resp = requests.post(TOKEN_URL, data={
        "grant_type": "refresh_token", "refresh_token": refresh_tok,
        "client_id": CLIENT_ID, "client_secret": CLIENT_SECRET,
    }, timeout=10)
    return resp.json().get("access_token") if resp.status_code == 200 else None

def onboard(access_tok, project_id):
    resp = requests.post(ONBOARD_URL,
        headers={"Authorization": f"Bearer {access_tok}", "Content-Type": "application/json",
                 "User-Agent": "antigravity/1.104.0 darwin/arm64"},
        json={"tierId": "standard-tier",
              "metadata": {"ideType": "IDE_UNSPECIFIED", "platform": "PLATFORM_UNSPECIFIED", "pluginType": "GEMINI"},
              "cloudaicompanionProject": project_id},
        timeout=15)
    if resp.status_code == 200 and resp.json().get("done"):
        return resp.json()["response"]["cloudaicompanionProject"]["id"]
    return None

conn = sqlite3.connect(DB)
working = conn.execute("SELECT project_id FROM provider_connections WHERE provider='antigravity' AND project_id IS NOT NULL AND project_id != '' LIMIT 1").fetchone()
if not working:
    print("No working project found!"); sys.exit(1)
PROJECT_ID = working[0]
rows = conn.execute("SELECT id, refresh_token FROM provider_connections WHERE provider='antigravity' AND is_active=1 AND (project_id IS NULL OR project_id='') AND refresh_token IS NOT NULL").fetchall()
print(f"Using projectId: {PROJECT_ID}, {len(rows)} accounts to fix")
fixed = failed = 0
for rid, rtok in rows:
    tok = refresh_token(rtok)
    if not tok: failed += 1; continue
    proj = onboard(tok, PROJECT_ID)
    if proj: conn.execute("UPDATE provider_connections SET project_id=? WHERE id=?", (proj, rid)); conn.commit(); fixed += 1
    else: failed += 1
    time.sleep(0.5)
print(f"Done: {fixed} fixed, {failed} failed"); conn.close()
