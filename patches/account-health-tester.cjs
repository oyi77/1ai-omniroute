/**
 * Account Health Tester
 * =====================
 * Tests all accounts per provider and marks unhealthy ones.
 * Runs on startup and periodically.
 * 
 * For each provider:
 *   - Tests account connectivity
 *   - Marks expired/banned accounts as inactive
 *   - Reports health summary
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_PREFIX = '[account-health-tester]';
const DATA_DIR = process.env.OMNI_DATA_DIR || path.join(os.homedir(), '.omniroute');
const DB_PATH = path.join(DATA_DIR, 'storage.sqlite');
const TEST_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// ── Database helpers ──────────────────────────────────────────────────────────

function getDb() {
  try {
    const Database = require('better-sqlite3');
    return new Database(DB_PATH, { readonly: false });
  } catch (e) {
    console.error(LOG_PREFIX, 'Cannot open database:', e.message);
    return null;
  }
}

function getProviders() {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare("SELECT DISTINCT provider FROM provider_connections WHERE is_active = 1").all().map(r => r.provider);
  } finally {
    db.close();
  }
}

function getAccountsByProvider(provider) {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT id, name, email, provider, access_token, refresh_token, project_id, 
             is_active, test_status, error_code, last_error
      FROM provider_connections 
      WHERE provider = ? AND is_active = 1
    `).all(provider);
  } finally {
    db.close();
  }
}

function updateAccountStatus(connId, updates) {
  const db = getDb();
  if (!db) return;
  try {
    const sets = [];
    const params = { id: connId };
    for (const [key, value] of Object.entries(updates)) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      sets.push(`${dbKey} = @${key}`);
      params[key] = value;
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE provider_connections SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
  } finally {
    db.close();
  }
}

// ── Test functions per provider ───────────────────────────────────────────────

async function testAntigravityAccount(account) {
  if (!account.access_token) return { ok: false, error: 'No access token' };
  if (!account.project_id) return { ok: false, error: 'No project_id' };
  
  try {
    const response = await fetch('https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.access_token}`,
      },
      body: JSON.stringify({
        project: account.project_id,
        model: 'gemini-2.0-flash',
        request: {
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 5 },
        },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) return { ok: true };
    
    const errorText = await response.text();
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Auth failed (${response.status})`, needsReauth: true };
    }
    if (response.status === 429) {
      return { ok: true, warning: 'Rate limited but account valid' };
    }
    return { ok: false, error: `HTTP ${response.status}: ${errorText.slice(0, 100)}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testClaudeAccount(account) {
  if (!account.access_token) return { ok: false, error: 'No access token' };
  
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.access_token}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) return { ok: true };
    
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Auth failed (${response.status})`, needsReauth: true };
    }
    if (response.status === 429) {
      return { ok: true, warning: 'Rate limited but account valid' };
    }
    const errorText = await response.text();
    return { ok: false, error: `HTTP ${response.status}: ${errorText.slice(0, 100)}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testCodexAccount(account) {
  if (!account.access_token) return { ok: false, error: 'No access token' };
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${account.access_token}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (response.ok) return { ok: true };
    
    if (response.status === 401 || response.status === 403) {
      return { ok: false, error: `Auth failed (${response.status})`, needsReauth: true };
    }
    if (response.status === 429) {
      return { ok: true, warning: 'Rate limited but account valid' };
    }
    const errorText = await response.text();
    return { ok: false, error: `HTTP ${response.status}: ${errorText.slice(0, 100)}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const TESTERS = {
  antigravity: testAntigravityAccount,
  claude: testClaudeAccount,
  codex: testCodexAccount,
};

// ── Main test runner ──────────────────────────────────────────────────────────

async function testProvider(provider) {
  const tester = TESTERS[provider];
  if (!tester) {
    console.log(LOG_PREFIX, `No tester for provider: ${provider}`);
    return;
  }

  const accounts = getAccountsByProvider(provider);
  if (accounts.length === 0) return;

  console.log(LOG_PREFIX, `Testing ${accounts.length} ${provider} accounts...`);

  let healthy = 0;
  let unhealthy = 0;
  let needsReauth = 0;

  for (const account of accounts) {
    const result = await tester(account);
    
    if (result.ok) {
      healthy++;
      updateAccountStatus(account.id, {
        testStatus: 'active',
        errorCode: null,
        lastError: result.warning || null,
        lastTested: new Date().toISOString(),
      });
    } else {
      unhealthy++;
      updateAccountStatus(account.id, {
        testStatus: result.needsReauth ? 'expired' : 'error',
        errorCode: result.error.slice(0, 50),
        lastError: result.error,
        lastTested: new Date().toISOString(),
      });
      
      if (result.needsReauth) {
        needsReauth++;
        updateAccountStatus(account.id, { isActive: 0 });
      }
    }
  }

  console.log(LOG_PREFIX, `${provider}: ${healthy} healthy, ${unhealthy} unhealthy (${needsReauth} need re-auth)`);
}

async function testAllProviders() {
  const providers = getProviders();
  console.log(LOG_PREFIX, `Starting health test for ${providers.length} providers`);
  
  for (const provider of providers) {
    await testProvider(provider);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let intervalId = null;

async function mainLoop() {
  try {
    await testAllProviders();
  } catch (e) {
    console.error(LOG_PREFIX, 'Health test error:', e.message);
  }
}

function start() {
  console.log(LOG_PREFIX, '🚀 Account health tester active');
  
  // Run after 30s delay (let system settle)
  setTimeout(mainLoop, 30000);
  
  // Schedule periodic tests
  intervalId = setInterval(mainLoop, TEST_INTERVAL_MS);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

start();
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
