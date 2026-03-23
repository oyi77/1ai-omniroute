#!/bin/bash
# postinstall.sh - Apply OmniRoute fixes after npm install/update
# Usage: bash ~/.omniroute/patches/postinstall.sh

OMNI_DIR="$HOME/.npm-global/lib/node_modules/omniroute/app"

echo "Applying OmniRoute stability patches..."

# === Patch 1: maxTokensHelper.ts - validate max_tokens ===
MAXTOKENS="$OMNI_DIR/open-sse/translator/helpers/maxTokensHelper.ts"
if [ -f "$MAXTOKENS" ]; then
  if ! grep -q 'typeof maxTokens !== "number" || maxTokens < 1' "$MAXTOKENS" 2>/dev/null; then
    sed -i '/let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;/a\
\
  if (typeof maxTokens !== "number" || maxTokens < 1) {\
    maxTokens = DEFAULT_MAX_TOKENS;\
  }' "$MAXTOKENS"
    echo "✅ max_tokens validation applied"
  else
    echo "⏭️  max_tokens already validated"
  fi
fi

# === Patch 2: chatCore.ts - 502 token refresh for OAuth providers ===
CHATCORE="$OMNI_DIR/open-sse/handlers/chatCore.ts"
if [ -f "$CHATCORE" ]; then
  if ! grep -q 'credentials.refreshToken.*// Only OAuth' "$CHATCORE" 2>/dev/null; then
    sed -i 's/providerResponse.status === HTTP_STATUS.BAD_GATEWAY &&/providerResponse.status === HTTP_STATUS.BAD_GATEWAY \&\& credentials.refreshToken  \/\/ Only OAuth providers have refresh tokens/' "$CHATCORE"
    echo "✅ 502 token refresh for OAuth applied"
  else
    echo "⏭️  502 token refresh already applied"
  fi
fi

# === Patch 3: antigravity.ts - projectId auto-provision ===
ANTIGRAVITY="$OMNI_DIR/open-sse/executors/antigravity.ts"
if [ -f "$ANTIGRAVITY" ]; then
  if ! grep -q 'credentials.connectionId' "$ANTIGRAVITY" 2>/dev/null; then
    echo "⚠️  antigravity.ts needs manual review"
  else
    echo "⏭️  antigravity.ts projectId auto-provision already present"
  fi
fi

echo ""
echo "=== Patch Summary ==="
echo "1. max_tokens: Validates against negative values"
echo "2. chatCore: 502 triggers token refresh for OAuth only"
echo "3. antigravity: Auto-fetches projectId when missing"
echo ""
echo "Done! Restart OmniRoute: sudo systemctl restart omniroute"
