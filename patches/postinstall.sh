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

# === Patch 4: combo.ts - quota-aware default strategy ===
COMBO="$OMNI_DIR/open-sse/services/combo.ts"
if [ -f "$COMBO" ]; then
  if ! grep -q 'quota-aware' "$COMBO" 2>/dev/null; then
    sed -i 's/combo.strategy || "priority"/combo.strategy || "quota-aware"/' "$COMBO"
    sed -i 's/import { checkFallbackError, formatRetryAfter, getProviderProfile } from ".\/accountFallback.ts"/import { checkFallbackError, formatRetryAfter, getProviderProfile, getAccountHealth } from ".\/accountFallback.ts";\nimport { getProviderConnections } from "..\/lib\/localDb.ts"/' "$COMBO"
    sed -i '/sortModelsByUsage(models, comboName) {/i\
async function sortModelsByQuota(models) {\
  const results = await Promise.all(\
    models.map(async (modelStr) => {\
      const parsed = parseModel(modelStr);\
      const provider = parsed.provider || parsed.providerAlias || "unknown";\
      try {\
        const connections = await getProviderConnections(provider);\
        if (!connections || connections.length === 0) return { modelStr, health: 100 };\
        let totalHealth = 0;\
        for (const conn of connections) totalHealth += getAccountHealth(conn);\
        return { modelStr, health: totalHealth \/ connections.length };\
      } catch { return { modelStr, health: 100 }; }\
    })\
  );\
  results.sort((a, b) => b.health - a.health);\
  return results.map((e) => e.modelStr);\
}\
' "$COMBO"
    sed -i '/Cost-optimized ordering: cheapest first/a\
  } else if (strategy === "quota-aware") {\
    orderedModels = await sortModelsByQuota(orderedModels);\
    log.info("COMBO", `Quota-aware ordering: healthiest first (${orderedModels[0]})`);' "$COMBO"
    echo "✅ quota-aware combo strategy applied"
  else
    echo "⏭️  quota-aware already enabled"
  fi
fi

echo ""
echo "=== Patch Summary ==="
echo "1. max_tokens: Validates against negative values"
echo "2. chatCore: 502 triggers token refresh for OAuth only"
echo "3. antigravity: Auto-fetches projectId when missing"
echo "4. combo: Quota-aware routing (healthiest account first)"
echo ""
echo "Done! Restart OmniRoute: sudo systemctl restart omniroute"
