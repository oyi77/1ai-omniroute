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

var CHUNK_GLOB = '[root-of-the-server]__f0f9eb3f._.js';

/** The minified string in the ORIGINAL (unpatched) chunk */
var THROW_EXPR = 'if(!a)throw Error("Missing Google projectId for Antigravity account. Please reconnect OAuth so OmniRoute can fetch your real Cloud Code project (loadCodeAssist).")';

/** The replacement: no throw, auto-fetch projectId (CONTINUE normal flow) */
var PATCH_EXPR = 'if(!a){let c;try{c=await(await fetch("https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${o?.accessToken||""}`,"User-Agent":"google-api-nodejs-client/9.15.1","X-Goog-Api-Client":"google-cloud-sdk vscode_cloudshelleditor/0.1","Client-Metadata":"{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}"},body:JSON.stringify({metadata:{ideType:"ANTIGRAVITY",platform:"PLATFORM_UNSPECIFIED",pluginType:"GEMINI"}})})).json()}catch(e){}let p=c?.cloudaicompanionProject;a="object"==typeof p&&null!==p&&p.id?p.id:"object"==typeof p&&null!==p?p.id||null:null;}';

// ─── Chunk Discovery & Patching ─────────────────────────────────────────────

var fs = require('fs');
var path = require('path');

/**
 * Recursively find the chunk file matching CHUNK_GLOB
 */
function findChunk(dir, filename, depth) {
  if (depth === undefined) depth = 0;
  if (depth > 6) return null; // safety limit

  try {
    var entries = fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var full = path.join(dir, entry.name);
      if (entry.name === filename) return full;
      if (entry.isDirectory()) {
        var found = findChunk(full, filename, depth + 1);
        if (found) return found;
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Main patch logic — runs on module load
 */
function applyPatch() {
  // 1. Locate the .next directory
  var omniDir = __dirname;
  var nextDir = path.join(omniDir, '.next');

  if (!fs.existsSync(nextDir)) {
    console.log('[antigravity-patch] ⚠ .next directory not found — skipping (development mode?)');
    return;
  }

  // 2. Find the chunk file
  var chunkPath = findChunk(nextDir, CHUNK_GLOB);
  if (!chunkPath) {
    console.log('[antigravity-patch] ⚠ chunk not found — maybe different OmniRoute version?');
    return;
  }

  // 3. Read the chunk
  var content;
  try {
    content = fs.readFileSync(chunkPath, 'utf-8');
  } catch (e) {
    console.error('[antigravity-patch] ✖ cannot read chunk:', e.message);
    return;
  }

  // 4. Check if already patched
  if (content.indexOf(PATCH_EXPR) !== -1) {
    console.log('[antigravity-patch] ✅ already patched (projectId auto-fetch active)');
    return;
  }

  // 5. Check if the unpatched expression exists
  if (content.indexOf(THROW_EXPR) === -1) {
    console.log('[antigravity-patch] ⚠ throw expression not found — maybe already patched or different version');
    return;
  }

  // 6. Apply the patch
  var patched = content.replace(THROW_EXPR, PATCH_EXPR);

  // 7. Write back
  try {
    fs.writeFileSync(chunkPath, patched, 'utf-8');
    console.log('[antigravity-patch] 🩹 patched successfully — projectId auto-fetch enabled');
  } catch (e) {
    console.error('[antigravity-patch] ✖ cannot write chunk:', e.message);
  }
}

// ─── Run on load ──────────────────────────────────────────────────────────────

applyPatch();
