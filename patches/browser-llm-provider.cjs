/**
 * Browser LLM Provider Registration — OmniRoute Patch
 * =====================================================
 * Registers the browser-llm-bridge (port 20130) as an
 * openai-compatible-local provider in OmniRoute's sqlite DB.
 *
 * Also adds a combo "auto/browser-free" pointing to web/* models.
 *
 * LOAD ORDER: Loaded after browser-llm-bridge.cjs (alphabetical)
 */

'use strict';

const LOG = '[browser-llm-provider]';
const DB_PATH = `${process.env.HOME}/.omniroute/storage.sqlite`;
const BRIDGE_URL = 'http://127.0.0.1:20130/v1';
const PROVIDER_ID = 'browser-llm-bridge-local';
const COMBO_NAME = 'auto/browser-free';

const WEB_MODELS = [
  'web/claude',
  'web/deepseek',
  'web/gemini',
];

// ── Singleton guard ──────────────────────────────────────────────────────────
if (global.__browserLlmProvider) {
  console.log(LOG, '⚠ Already registered, skipping');
  return;
}
global.__browserLlmProvider = true;

// ── Database interaction ─────────────────────────────────────────────────────
function getDb() {
  // Try better-sqlite3 (OmniRoute uses it internally)
  try {
    const Database = require('better-sqlite3');
    return Database(DB_PATH);
  } catch (e) {}

  // Try from OmniRoute's node_modules
  try {
    const paths = [
      '/home/openclaw/.npm-global/lib/node_modules/omniroute/node_modules/better-sqlite3',
      '/home/linuxbrew/.linuxbrew/lib/node_modules/omniroute/node_modules/better-sqlite3',
    ];
    for (const p of paths) {
      try {
        const Database = require(p);
        return Database(DB_PATH);
        // eslint-disable-next-line no-empty
      } catch (_) {}
    }
  } catch (e) {}

  return null;
}

function registerProvider(db) {
  const now = new Date().toISOString();

  const providerData = JSON.stringify({
    baseUrl: BRIDGE_URL,
    models: WEB_MODELS,
    description: 'Browser LLM Bridge — free web UI access via CDP (no API key)',
    free_tier: true,
    added_at: now,
  });

  // Check if already exists
  const existing = db.prepare('SELECT id FROM provider_connections WHERE id = ?').get(PROVIDER_ID);

  if (existing) {
    console.log(LOG, `✅ Provider '${PROVIDER_ID}' already registered`);
    // Update the URL in case it changed
    db.prepare(`
      UPDATE provider_connections
      SET provider_specific_data = ?, updated_at = ?
      WHERE id = ?
    `).run(providerData, now, PROVIDER_ID);
    return false; // already existed
  }

  db.prepare(`
    INSERT INTO provider_connections (
      id, provider, auth_type, name, api_key,
      is_active, priority, global_priority,
      provider_specific_data, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    PROVIDER_ID,
    'openai-compatible-local',
    'apikey',
    'Browser LLM Bridge (Free)',
    'no-key-needed',
    1,     // is_active
    100,   // priority
    90,    // global_priority (slightly lower than paid providers)
    providerData,
    now,
    now,
  );

  console.log(LOG, `✅ Provider registered: ${PROVIDER_ID} → ${BRIDGE_URL}`);
  return true;
}

function registerCombo(db) {
  const now = new Date().toISOString();

  // Build combo data matching OmniRoute combo schema
  const comboData = JSON.stringify({
    name: COMBO_NAME,
    strategy: 'fallback',
    timeout_ms: 120000, // 2 min (browser is slow)
    models: WEB_MODELS.map((id, i) => ({
      provider: 'openai-compatible-local',
      provider_id: PROVIDER_ID,
      model: id,
      priority: i + 1,
    })),
    id: COMBO_NAME,
    description: 'Free browser-based LLM access (Claude, DeepSeek, Gemini via web UI)',
    free: true,
  });

  const existing = db.prepare('SELECT name FROM combos WHERE name = ?').get(COMBO_NAME);

  if (existing) {
    db.prepare('UPDATE combos SET data = ?, updated_at = ? WHERE name = ?')
      .run(comboData, now, COMBO_NAME);
    console.log(LOG, `✅ Combo '${COMBO_NAME}' updated`);
  } else {
    db.prepare(`
      INSERT INTO combos (id, name, data, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(COMBO_NAME, COMBO_NAME, comboData, now, now);
    console.log(LOG, `✅ Combo '${COMBO_NAME}' created`);
  }
}

// ── Apply ─────────────────────────────────────────────────────────────────────
function apply() {
  const db = getDb();

  if (!db) {
    console.error(LOG, '❌ Could not open OmniRoute DB at', DB_PATH);
    console.error(LOG, '   Install better-sqlite3 or check DB path');
    return;
  }

  try {
    const providerNew = registerProvider(db);
    registerCombo(db);

    if (providerNew) {
      console.log(LOG, '🎉 Browser LLM provider fully registered!');
      console.log(LOG, `   Use model: ${WEB_MODELS.join(', ')}`);
      console.log(LOG, `   Or combo:  ${COMBO_NAME}`);
    }
  } catch (err) {
    console.error(LOG, '❌ Registration failed:', err.message);
  } finally {
    db.close();
  }
}

// Register diagnostics endpoint via patch-hooks
if (global.__patchHooks) {
  global.__patchHooks.registerHttpMiddleware('browser-llm-provider-info', (req, res, next) => {
    if (req.url === '/api/browser-llm-provider/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'active',
        providerId: PROVIDER_ID,
        bridgeUrl: BRIDGE_URL,
        combo: COMBO_NAME,
        models: WEB_MODELS,
      }));
      return;
    }
    next();
  }, { priority: 51 });
}

apply();
console.log(LOG, '✨ Browser LLM Provider patch loaded');
