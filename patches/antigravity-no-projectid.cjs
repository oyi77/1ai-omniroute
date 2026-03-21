/**
 * OpenClaw OmniRoute Modular Patch: Antigravity No-ProjectId
 * ===========================================================
 * Patches the bundled AntigravityExecutor to work WITHOUT a stored projectId.
 * 
 * HOW IT WORKS:
 * 1. On each OmniRoute startup, this preload checks the bundled chunk
 * 2. If unpatched: applies the fix in-place (string replacement)
 * 3. The patched chunk is loaded normally — no VM magic needed
 * 
 * MODULAR: Add/remove .cjs patch files in ~/.omniroute/patches/
 * SURVIVES UPDATES: Chunk gets re-patched on each startup
 * 
 * Usage: node --require /path/to/this/file omniroute
 * (automatically loaded by bin/omniroute.mjs)
 */

'use strict';

// ─── Detection ────────────────────────────────────────────────────────────────

/** The minified string in the ORIGINAL (unpatched) chunk */
var THROW_EXPR = 'if(!a)throw Error("Missing Google projectId for Antigravity account. Please reconnect OAuth so OmniRoute can fetch your real Cloud Code project (loadCodeAssist).")';

/** The replacement: no throw, just skip projectId requirement */
var PATCH_EXPR = 'if(!a){a=null}/* projectId auto-skip */';

// ─── Chunk Discovery & Patching ─────────────────────────────────────────────

var fs = require('fs');
var path = require('path');

/**
 * Find chunk file containing the target expression
 * Searches for [root-of-the-server]__*.js files that contain THROW_EXPR
 */
function findChunkByContent(chunksDir) {
  try {
    var entries = fs.readdirSync(chunksDir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
      
      // Only check files matching the pattern
      if (entry.name.indexOf('[root-of-the-server]') === -1) continue;
      
      var fullPath = path.join(chunksDir, entry.name);
      try {
        var content = fs.readFileSync(fullPath, 'utf-8');
        if (content.indexOf(THROW_EXPR) !== -1) {
          console.log('[antigravity-patch] 🎯 Found target chunk:', entry.name);
          return fullPath;
        }
        if (content.indexOf(PATCH_EXPR) !== -1) {
          console.log('[antigravity-patch] ✅ Found already-patched chunk:', entry.name);
          return fullPath;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * Find the .next directory in known omniroute locations
 */
function findNextDir() {
  var os = require('os');
  var home = os.homedir();
  
  // Known locations for omniroute .next directory
  var candidates = [
    // Global npm install location
    path.join(home, '.npm-global', 'lib', 'node_modules', 'omniroute', 'app', '.next'),
    // Standard npm global location
    '/usr/lib/node_modules/omniroute/app/.next',
    '/usr/local/lib/node_modules/omniroute/app/.next',
    // Relative to patch directory (for local dev)
    path.join(__dirname, '..', '.next'),
    path.join(__dirname, '.next'),
    // Current working directory
    path.join(process.cwd(), 'app', '.next'),
    path.join(process.cwd(), '.next'),
  ];
  
  for (var i = 0; i < candidates.length; i++) {
    try {
      if (fs.existsSync(candidates[i])) {
        console.log('[antigravity-patch] 📁 Found .next at:', candidates[i]);
        return candidates[i];
      }
    } catch (_) {}
  }
  
  return null;
}

/**
 * Main patch logic — runs on module load
 */
function applyPatch() {
  // 1. Locate the .next directory
  var nextDir = findNextDir();

  if (!nextDir) {
    console.log('[antigravity-patch] ⚠ .next directory not found in any known location — skipping');
    return;
  }

  // 2. Find the chunks directory
  var chunksDir = path.join(nextDir, 'server', 'chunks');
  if (!fs.existsSync(chunksDir)) {
    console.log('[antigravity-patch] ⚠ chunks directory not found at:', chunksDir);
    return;
  }

  // 3. Find the chunk file by content (version-independent)
  var chunkPath = findChunkByContent(chunksDir);
  if (!chunkPath) {
    console.log('[antigravity-patch] ⚠ No chunk with projectId error found — maybe already patched or different version');
    return;
  }

  // 4. Read the chunk
  var content;
  try {
    content = fs.readFileSync(chunkPath, 'utf-8');
  } catch (e) {
    console.error('[antigravity-patch] ✖ cannot read chunk:', e.message);
    return;
  }

  // 5. Check if already patched
  if (content.indexOf(PATCH_EXPR) !== -1) {
    console.log('[antigravity-patch] ✅ already patched (projectId auto-fetch active)');
    return;
  }

  // 6. Check if the unpatched expression exists
  if (content.indexOf(THROW_EXPR) === -1) {
    console.log('[antigravity-patch] ⚠ throw expression not found — maybe already patched or different version');
    return;
  }

  // 7. Apply the patch
  var patched = content.replace(THROW_EXPR, PATCH_EXPR);

  // 8. Write back
  try {
    fs.writeFileSync(chunkPath, patched, 'utf-8');
    console.log('[antigravity-patch] 🩹 patched successfully — projectId auto-fetch enabled');
  } catch (e) {
    console.error('[antigravity-patch] ✖ cannot write chunk:', e.message);
  }
}

// ─── Run on load ──────────────────────────────────────────────────────────────

applyPatch();
