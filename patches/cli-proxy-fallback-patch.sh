#!/bin/bash
# CLIProxyAPI Fallback Patch for chatCore.ts
# =============================================
# Injects CLIProxyAPI fallback into OmniRoute's chatCore.ts
# When antigravity requests fail (502/403/401/429/503), retries through CLIProxyAPI
#
# The key insight: chatCore.ts receives the original OpenAI-format body.
# CLIProxyAPI exposes OpenAI-compatible /v1/chat/completions endpoint.
# So we can send the original body directly — no format conversion needed.

set -e

LOG_PREFIX="[cli-proxy-fallback-patch]"
PATCHES_DIR="$(cd "$(dirname "$0")" && pwd)"

# Find OmniRoute installation
find_omniroute() {
  local paths=(
    "/home/linuxbrew/.linuxbrew/lib/node_modules/omniroute"
    "$HOME/.npm-global/lib/node_modules/omniroute"
    "$HOME/.omniroute/node_modules/omniroute"
  )
  
  for p in "${paths[@]}"; do
    if [ -d "$p/open-sse/handlers" ]; then
      echo "$p"
      return 0
    fi
  done
  
  # Also check source directory
  if [ -d "/home/openclaw/omniroute-src/open-sse/handlers" ]; then
    echo "/home/openclaw/omniroute-src"
    return 0
  fi
  
  return 1
}

OMNIROUTE_PATH=$(find_omniroute)

if [ -z "$OMNIROUTE_PATH" ]; then
  echo "$LOG_PREFIX ERROR: Could not find OmniRoute installation"
  exit 1
fi

CHATCORE_PATH="$OMNIROUTE_PATH/open-sse/handlers/chatCore.ts"

if [ ! -f "$CHATCORE_PATH" ]; then
  echo "$LOG_PREFIX ERROR: chatCore.ts not found at $CHATCORE_PATH"
  exit 1
fi

echo "$LOG_PREFIX Found chatCore.ts at: $CHATCORE_PATH"

# Check if already patched
if grep -q "CLIProxyAPI fallback" "$CHATCORE_PATH" 2>/dev/null; then
  echo "$LOG_PREFIX Patch already applied"
  exit 0
fi

# Create backup
BACKUP_PATH="${CHATCORE_PATH}.pre-cliproxyapi-backup"
if [ ! -f "$BACKUP_PATH" ]; then
  cp "$CHATCORE_PATH" "$BACKUP_PATH"
  echo "$LOG_PREFIX Backup created: $BACKUP_PATH"
fi

# Apply patch: inject CLIProxyAPI fallback before the final error return
# The injection point is before line 849: "} else { persistFailureUsage"
# We add a check that routes antigravity failures through CLIProxyAPI

python3 << 'PYEOF'
import re
import sys
import os

chatcore_path = os.environ.get("CHATCORE_PATH", "")

with open(chatcore_path, "r") as f:
    content = f.read()

# Inject CLIProxyAPI fallback INSIDE the } else { block (for non-model-unavailable errors)
# The target is:
#     } else {
#       persistFailureUsage(statusCode, `upstream_${statusCode}`);
#       return createErrorResult(statusCode, errMsg, retryAfterMs);
#     }
#
# We inject the fallback code AFTER "} else {" and BEFORE persistFailureUsage,
# so if fallback succeeds, we skip the error return.

fallback_code = '''    } else {
      // CLIProxyAPI Fallback for Antigravity
      // When antigravity requests fail (502/403/401/429/503), retry through
      // CLIProxyAPI at localhost:8317. The original body is already in OpenAI
      // format, so we send it directly to CLIProxyAPI /v1/chat/completions.
      let cliProxyFallbackAttempted = false;
      if (provider === "antigravity" && [502, 401, 403, 429, 503].includes(statusCode)) {
        cliProxyFallbackAttempted = true;
        const CLI_PROXY_API = process.env.CLIPROXYAPI_URL || "http://127.0.0.1:8317";
        const cliProxyModel = model || requestedModel || "gemini-2.5-flash";
        log?.info?.("CLIProxyAPI", `Antigravity ${statusCode} — retrying via CLIProxyAPI (${cliProxyModel})`);
        try {
          const proxyHeaders = {
            "Content-Type": "application/json",
            "Authorization": "Bearer omniroute-internal",
          };
          const proxyBody = { ...body, model: cliProxyModel, stream: stream || false };
          const proxyResponse = await fetch(`${CLI_PROXY_API}/v1/chat/completions`, {
            method: "POST",
            headers: proxyHeaders,
            body: JSON.stringify(proxyBody),
            signal: streamController.signal,
          });
          if (proxyResponse.ok) {
            log?.info?.("CLIProxyAPI", `Fallback succeeded via CLIProxyAPI for ${cliProxyModel}`);
            providerResponse = proxyResponse;
            providerUrl = `${CLI_PROXY_API}/v1/chat/completions`;
            providerHeaders = proxyHeaders;
          } else {
            const proxyError = await proxyResponse.text().catch(() => "unknown");
            log?.warn?.("CLIProxyAPI", `Fallback failed (${proxyResponse.status}): ${proxyError}`);
          }
        } catch (proxyErr) {
          if (proxyErr?.name === "AbortError") {
            log?.warn?.("CLIProxyAPI", "Fallback request aborted");
          } else {
            log?.warn?.("CLIProxyAPI", `Fallback error: ${proxyErr?.message || proxyErr}`);
          }
        }
      }
'''

# Pattern: } else {\n      persistFailureUsage(statusCode, `upstream_${statusCode}`);
pattern = r'(    \} else \{)\n(      persistFailureUsage\(statusCode, `upstream_\$\{statusCode\}`\);)'

if re.search(pattern, content):
    content = re.sub(pattern, fallback_code + r'      persistFailureUsage(statusCode, `upstream_${statusCode}`);', content)
    print("[cli-proxy-fallback-patch] Injected CLIProxyAPI fallback at error return point")
else:
    print("[cli-proxy-fallback-patch] ERROR: Could not find injection point")
    sys.exit(1)

with open(chatcore_path, "w") as f:
    f.write(content)

print("[cli-proxy-fallback-patch] Patch applied successfully")
PYEOF
