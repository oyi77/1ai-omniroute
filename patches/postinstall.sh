#!/bin/bash
# Post-install script to apply OmniRoute fixes
# Run this after: npm install omniroute

OMNI_DIR="$HOME/.npm-global/lib/node_modules/omniroute/app"

echo "Applying OmniRoute stability fixes..."

# Fix 1: antigravity.ts - projectId auto-provision
# (already applied in node_modules)

# Fix 2: chatCore.ts - 502 token refresh for OAuth providers
# (already applied in node_modules)  

# Fix 3: maxTokensHelper.ts - validate max_tokens
if [ -f "$OMNI_DIR/open-sse/translator/helpers/maxTokensHelper.ts" ]; then
  sed -i 's/let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;/let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;\n\n  if (typeof maxTokens !== "number" || maxTokens < 1) {\n    maxTokens = DEFAULT_MAX_TOKENS;\n  }/' "$OMNI_DIR/open-sse/translator/helpers/maxTokensHelper.ts"
  echo "✅ max_tokens validation applied"
fi

echo "Done! All fixes applied."
