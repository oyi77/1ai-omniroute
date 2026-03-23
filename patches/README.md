# OmniRoute Patches

## 502 Token Refresh Fix

**Fixed:** Now only triggers token refresh on 502 for OAuth-based providers (those with `refreshToken`).

**Why it crashed before:** The original fix triggered token refresh on ALL 502 errors for ALL providers, including API key-based providers that don't have refresh tokens. This caused unnecessary refresh attempts and circuit breaker issues.

**How it works now:**
- 401/403 → Always try token refresh (auth errors)
- 502 → Only try token refresh if `credentials.refreshToken` exists (OAuth providers like Antigravity)

**Apply fix:**
```bash
bash patches/apply-502-fix.sh
```

**Verify fix:**
```bash
node patches/test-502-fix.js
```
