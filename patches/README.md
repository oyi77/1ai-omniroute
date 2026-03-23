# OmniRoute Antigravity 502 Fix

## Problem
Antigravity provider was returning 502 Bad Gateway errors, which were not being handled by the token refresh mechanism. Only 401 and 403 were triggering token refresh.

## Solution
Modified `chatCore.ts` to also trigger token refresh on 502 errors. When Antigravity returns 502, the system will:
1. Automatically refresh the OAuth token
2. Retry the request with the new token
3. Log the status code for debugging
4. Warn if refresh doesn't resolve the issue

## Files

| File | Purpose |
|------|---------|
| `apply-502-fix.sh` | Applies fix after npm install/update |
| `test-502-fix.js` | Verifies fix is properly applied |
| `0001-antigravity-502-fix.patch` | patch-package compatible patch |

## Usage

### Check if fix is applied
```bash
node ~/.omniroute/patches/test-502-fix.js
```

### Apply fix manually
```bash
bash ~/.omniroute/patches/apply-502-fix.sh
```

### After npm update
```bash
npm update omniroute && bash ~/.omniroute/patches/apply-502-fix.sh
```

## How It Works

The fix adds `HTTP_STATUS.BAD_GATEWAY` (502) to the token refresh condition:

```typescript
if (
  providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
  providerResponse.status === HTTP_STATUS.FORBIDDEN ||
  providerResponse.status === HTTP_STATUS.BAD_GATEWAY  // ADDED
) {
  // Token refresh logic
}
```

## Verification

All tests pass:
```
✅ BAD_GATEWAY in token refresh condition
✅ Token refresh runs on 502 errors
✅ Status code in refresh log message
✅ Status code in refresh failed log
✅ Handles retry after refresh failure
```

## Troubleshooting

If 502 errors persist after fix:
1. Check logs for `[TOKEN]` messages
2. Verify Antigravity OAuth connection is active
3. Try reconnecting the account in Settings
4. Check `~/.omniroute/storage.sqlite` for error codes
