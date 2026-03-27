#!/bin/bash
set -e

PATCHES_SOURCE="/home/openclaw/1ai-omniroute/patches"
PATCHES_TARGET="/home/openclaw/.omniroute/patches"
OMNI_SRC="/home/openclaw/omniroute-src"
PATCH_LOG="/home/openclaw/.omniroute/patches/install.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$PATCH_LOG"
}

log "=== Starting patch installation ==="

# Ensure target directory exists
mkdir -p "$PATCHES_TARGET"

# Copy all patches
log "Copying patches from $PATCHES_SOURCE to $PATCHES_TARGET..."
cp -f "$PATCHES_SOURCE"/*.cjs "$PATCHES_TARGET/" 2>/dev/null || true
cp -f "$PATCHES_SOURCE"/*.patch "$PATCHES_TARGET/" 2>/dev/null || true
cp -f "$PATCHES_SOURCE"/*.ts "$PATCHES_TARGET/" 2>/dev/null || true

PATCH_COUNT=$(ls -1 "$PATCHES_TARGET"/*.cjs 2>/dev/null | wc -l)
log "Installed $PATCH_COUNT patch files"

# Copy wreq-js stub if exists
if [ -f "$PATCHES_SOURCE/wreq-js.stub.ts" ]; then
  cp -f "$PATCHES_SOURCE/wreq-js.stub.ts" "$OMNI_SRC/src/open-sse/utils/"
  log "Copied wreq-js.stub.ts"
fi

# Apply .patch files
for patch_file in "$PATCHES_SOURCE"/*.patch; do
  if [ -f "$patch_file" ]; then
    patch_name=$(basename "$patch_file")
    log "Applying patch: $patch_name"
    # Apply git patch if it applies cleanly
    git -C "$OMNI_SRC" apply --check "$patch_file" 2>/dev/null && \
      git -C "$OMNI_SRC" apply "$patch_file" 2>/dev/null && \
      log "Applied $patch_name" || \
      log "Skipped $patch_name (may already be applied or conflict)"
  fi
done

# Sync UI patches to omniroute-src
log "Syncing UI patches..."
bash /home/openclaw/1ai-omniroute/scripts/sync-ui-patches.sh

log "=== Patch installation complete ==="
