#!/bin/bash
# Auto-patch on OmniRoute startup
# Add to systemd service ExecStartPre or call from startup

OMNI_DIR="$HOME/.npm-global/lib/node_modules/omniroute/app"
PATCH_LOG="$HOME/.omniroute/patches/auto-patch.log"

log() {
  echo "[$(date -Iseconds)] $1" | tee -a "$PATCH_LOG"
}

log "Checking OmniRoute patches..."

PATCHED=0

# Patch 1: maxTokensHelper.ts
MAXTOKENS="$OMNI_DIR/open-sse/translator/helpers/maxTokensHelper.ts"
if [ -f "$MAXTOKENS" ] && ! grep -q 'typeof maxTokens !== "number" || maxTokens < 1' "$MAXTOKENS" 2>/dev/null; then
  sed -i '/let maxTokens = body.max_tokens || DEFAULT_MAX_TOKENS;/a\
\
  if (typeof maxTokens !== "number" || maxTokens < 1) {\
    maxTokens = DEFAULT_MAX_TOKENS;\
  }' "$MAXTOKENS"
  log "✅ Applied: max_tokens validation"
  PATCHED=1
fi

# Patch 2: chatCore.ts
CHATCORE="$OMNI_DIR/open-sse/handlers/chatCore.ts"
if [ -f "$CHATCORE" ] && ! grep -q 'credentials.refreshToken.*// Only OAuth' "$CHATCORE" 2>/dev/null; then
  sed -i 's/providerResponse.status === HTTP_STATUS.BAD_GATEWAY &&/providerResponse.status === HTTP_STATUS.BAD_GATEWAY \&\& credentials.refreshToken  \/\/ Only OAuth providers have refresh tokens/' "$CHATCORE"
  log "✅ Applied: 502 token refresh for OAuth"
  PATCHED=1
fi

# Patch 3: antigravity.ts (check presence, manual review needed if missing)
ANTIGRAVITY="$OMNI_DIR/open-sse/executors/antigravity.ts"
if [ -f "$ANTIGRAVITY" ] && ! grep -q 'credentials.connectionId' "$ANTIGRAVITY" 2>/dev/null; then
  log "⚠️  antigravity.ts needs manual review - projectId auto-provision missing"
  PATCHED=1
fi

if [ $PATCHED -eq 0 ]; then
  log "⏭️  All patches already applied"
else
  log "✨ Patches applied - restart needed for changes to take effect"
fi

exit 0
