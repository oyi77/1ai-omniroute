# OmniRoute Antigravity Stability Fix

## Problem
1. Antigravity 502 errors due to missing Google projectId
2. Token refresh not triggering on 502 errors
3. 82/84 Antigravity connections missing projectId after old OAuth flow

## Solution
Two-part fix:

### Part 1: Auto-provision projectId
Modified `antigravity.ts` to:
- Auto-fetch projectId via `loadCodeAssist` API when missing
- Persist fetched projectId to database
- Retry request on "Missing Google projectId" error

### Part 2: Smart token refresh on 502
Modified `chatCore.ts` to:
- Trigger token refresh on 502 for OAuth providers only
- Skip for API-key based providers

## Files

| File | Purpose |
|------|---------|
| `apply-502-fix.sh` | Applies fix after npm install/update |
| `test-projectid.sh` | Tests projectId auto-provision |
| `antigravity.ts` | Auto-provision projectId |
| `chatCore.ts` | Smart 502 token refresh |

## Current Status

```
84 Antigravity connections:
- 2 have projectId (working)
- 82 missing projectId (will auto-provision on first request)
```

## Usage

### Check status
```bash
bash ~/.omniroute/patches/test-projectid.sh
```

### After npm update
```bash
npm update omniroute && bash ~/.omniroute/patches/apply-502-fix.sh
```

## How It Works

1. Request comes in for Antigravity without projectId
2. Code calls `loadCodeAssist` API to fetch projectId
3. If successful, projectId is saved to database
4. If loadCodeAssist returns "done: false", calls `onboardUser` to provision
5. Request is retried with fetched projectId
6. Future requests use cached projectId from database

## Troubleshooting

If 502 errors persist:
1. Check logs for `[ANTIGRAVITY]` messages
2. Verify OAuth connection is active
3. Try reconnecting account in Settings
4. Check `~/.omniroute/storage.sqlite` for error codes
