#!/bin/bash
# OmniRoute Antigravity 502 Fix - Post-Install Patch Script
# =========================================================
# This script applies the 502 token refresh fix to OmniRoute after npm install
# Run this after: npm install omniroute OR npm update omniroute

set -e

OMNI_PATH=""
LOG_PREFIX="[omni-502-fix]"

find_omniroute() {
  local paths=(
    "$HOME/.npm-global/lib/node_modules/omniroute"
    "$HOME/.omniroute/node_modules/omniroute"
    "/home/openclaw/.npm-global/lib/node_modules/omniroute"
    "/mnt/data/openclaw/home-symlinks/npm-global/lib/node_modules/omniroute"
  )
  
  for p in "${paths[@]}"; do
    if [ -d "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

apply_fix() {
  local chatcore="$OMNI_PATH/app/open-sse/handlers/chatCore.ts"
  
  if [ ! -f "$chatcore" ]; then
    echo "$LOG_PREFIX ERROR: chatCore.ts not found at $chatcore"
    return 1
  fi
  
  if grep -q 'providerResponse.status === HTTP_STATUS.BAD_GATEWAY' "$chatcore" 2>/dev/null; then
    echo "$LOG_PREFIX ✅ Fix already applied (BAD_GATEWAY found in token refresh)"
    return 0
  fi
  
  echo "$LOG_PREFIX Applying 502 fix to chatCore.ts..."
  
  # Find the line with "// Handle 401/403 - try token refresh" and replace the condition
  sed -i 's/providerResponse.status === HTTP_STATUS.FORBIDDEN$/providerResponse.status === HTTP_STATUS.FORBIDDEN ||\n    providerResponse.status === HTTP_STATUS.BAD_GATEWAY/' "$chatcore"
  
  # Update log messages to include status code
  sed -i 's/| refreshed"$/| refreshed (${providerResponse.status})"/' "$chatcore"
  sed -i 's/| refresh failed"$/| refresh failed (${providerResponse.status})"/' "$chatcore"
  
  # Add handling for retry failure case
  if ! grep -q 'refresh didn.t help' "$chatcore" 2>/dev/null; then
    sed -i '/providerResponse = retryResult.response;/a\        } else if (\n          retryResult.response.status === HTTP_STATUS.UNAUTHORIZED ||\n          retryResult.response.status === HTTP_STATUS.FORBIDDEN ||\n          retryResult.response.status === HTTP_STATUS.BAD_GATEWAY\n        ) {\n          log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh didn'"'"'t help (${retryResult.response.status})`);' "$chatcore"
  fi
  
  # Verify the fix was applied
  if grep -q 'HTTP_STATUS.BAD_GATEWAY' "$chatcore" 2>/dev/null; then
    echo "$LOG_PREFIX ✅ Fix applied successfully!"
    return 0
  else
    echo "$LOG_PREFIX ⚠️ Fix may not have applied correctly - please verify manually"
    return 1
  fi
}

main() {
  echo "$LOG_PREFIX Starting OmniRoute 502 fix..."
  
  OMNI_PATH=$(find_omniroute)
  
  if [ -z "$OMNI_PATH" ]; then
    echo "$LOG_PREFIX ERROR: Could not find OmniRoute installation"
    echo "$LOG_PREFIX Please ensure omniroute is installed via npm"
    exit 1
  fi
  
  echo "$LOG_PREFIX Found OmniRoute at: $OMNI_PATH"
  
  apply_fix
  
  echo "$LOG_PREFIX Done!"
}

main "$@"
