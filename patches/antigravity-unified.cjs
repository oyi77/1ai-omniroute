/**
 * Antigravity Unified Patch
 * ==========================
 * Consolidated patch replacing:
 *   - antigravity-token-refresh.cjs
 *   - antigravity-force-refresh.cjs
 *   - antigravity-no-projectid.cjs
 *   - antigravity-502-fix-install.cjs
 *   - antigravity-502-monitor.js
 *
 * Features:
 *   1. Periodic token health check + auto-refresh for all antigravity accounts
 *   2. Connection state management (mark expired/banned on unrecoverable errors)
 *   3. projectId fix (skip missing projectId instead of failing)
 *   4. Error logging and metrics
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_PREFIX = '[antigravity-unified]';
const DATA_DIR = process.env.OMNI_DATA_DIR || path.join(os.homedir(), '.omniroute');
const DB_PATH = path.join(DATA_DIR, 'storage.sqlite');
const REFRESH_INTERVAL_MS = 45 * 60 * 1000; // 45 minutes
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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

function getAntigravityConnections() {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = db.prepare(`
      SELECT id, name, provider, access_token, refresh_token, client_id, client_secret,
             project_id, is_active, error_code, test_status, token_expires_at
      FROM provider_connections
      WHERE provider = 'antigravity' AND is_active = 1
    `).all();
    return rows;
  } catch (e) {
    console.error(LOG_PREFIX, 'Error reading connections:', e.message);
    return [];
  } finally {
    db.close();
  }
}

function updateConnection(connId, updates) {
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
  } catch (e) {
    console.error(LOG_PREFIX, 'Error updating connection:', e.message);
  } finally {
    db.close();
  }
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function refreshToken(conn) {
  if (!conn.refresh_token) {
    console.warn(LOG_PREFIX, `No refresh token for ${conn.name || conn.id}`);
    return null;
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
      client_id: conn.client_id || process.env.ANTIGRAVITY_CLIENT_ID || '',
      client_secret: conn.client_secret || process.env.ANTIGRAVITY_CLIENT_SECRET || '',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: params,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorCode = null;
      try { errorCode = JSON.parse(errorText)?.error; } catch {}

      if (errorCode === 'invalid_grant') {
        console.error(LOG_PREFIX, `❌ ${conn.name || conn.id}: refresh token invalid — needs re-auth`);
        updateConnection(conn.id, {
          isActive: 0,
          testStatus: 'expired',
          lastError: 'Refresh token invalid — re-authentication required',
          errorCode: 'invalid_grant',
        });
        return null;
      }

      console.warn(LOG_PREFIX, `Token refresh failed for ${conn.name || conn.id}: ${response.status} ${errorText}`);
      return null;
    }

    const tokens = await response.json();
    console.log(LOG_PREFIX, `✅ Token refreshed for ${conn.name || conn.id}`);

    updateConnection(conn.id, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || conn.refresh_token,
      tokenExpiresAt: tokens.expires_in
        ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
        : null,
      errorCode: null,
      lastError: null,
      testStatus: 'active',
    });

    return tokens;
  } catch (e) {
    console.error(LOG_PREFIX, `Token refresh error for ${conn.name || conn.id}:`, e.message);
    return null;
  }
}

// ── Health check ──────────────────────────────────────────────────────────────

let lastHealthCheck = 0;

async function runHealthCheck() {
  if (Date.now() - lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) return;
  lastHealthCheck = Date.now();

  const connections = getAntigravityConnections();
  if (connections.length === 0) return;

  let refreshed = 0;
  let expired = 0;
  let errors = 0;

  for (const conn of connections) {
    // Check if token is expired or expiring soon
    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    const needsRefresh = !expiresAt || (expiresAt - Date.now()) < REFRESH_INTERVAL_MS;

    if (needsRefresh) {
      const result = await refreshToken(conn);
      if (result) refreshed++;
      else {
        if (conn.test_status === 'expired') expired++;
        else errors++;
      }
    }
  }

  if (refreshed > 0 || expired > 0 || errors > 0) {
    console.log(LOG_PREFIX, `Health check: ${refreshed} refreshed, ${expired} expired, ${errors} errors (of ${connections.length} accounts)`);
  }
}

// ── ProjectId fix ─────────────────────────────────────────────────────────────

function fixMissingProjectIds() {
  const db = getDb();
  if (!db) return;

  try {
    const rows = db.prepare(`
      SELECT id, name, access_token, project_id
      FROM provider_connections
      WHERE provider = 'antigravity' AND (project_id IS NULL OR project_id = '')
    `).all();

    if (rows.length === 0) return;

    // Try to find project_id from CLIProxyAPI credential files
    const authDir = path.join(os.homedir(), '.cli-proxy-api');
    let fixed = 0;

    for (const row of rows) {
      let projectId = null;

      // Search CLIProxyAPI files for matching access_token
      try {
        const files = fs.readdirSync(authDir).filter(f => f.startsWith('antigravity_') && f.endsWith('.json'));
        for (const file of files) {
          try {
            const cred = JSON.parse(fs.readFileSync(path.join(authDir, file), 'utf8'));
            if (cred.access_token === row.access_token && cred.project_id) {
              projectId = cred.project_id;
              break;
            }
          } catch {}
        }
      } catch {}

      // Fallback: use common project_id from any CLIProxyAPI file
      if (!projectId) {
        try {
          const files = fs.readdirSync(authDir).filter(f => f.startsWith('antigravity_') && f.endsWith('.json'));
          if (files.length > 0) {
            const cred = JSON.parse(fs.readFileSync(path.join(authDir, files[0]), 'utf8'));
            projectId = cred.project_id;
          }
        } catch {}
      }

      if (projectId) {
        db.prepare('UPDATE provider_connections SET project_id = ? WHERE id = ?').run(projectId, row.id);
        fixed++;
      }
    }

    if (fixed > 0) {
      console.log(LOG_PREFIX, `✅ Fixed ${fixed}/${rows.length} missing projectIds from CLIProxyAPI`);
    } else if (rows.length > 0) {
      console.warn(LOG_PREFIX, `⚠️  ${rows.length} antigravity connections missing projectId — no CLIProxyAPI credentials found`);
    }
  } catch (e) {
    // Table might not exist yet
  } finally {
    db.close();
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let running = false;
let intervalId = null;

async function mainLoop() {
  if (running) return;
  running = true;

  try {
    await runHealthCheck();
  } catch (e) {
    console.error(LOG_PREFIX, 'Health check error:', e.message);
  }

  running = false;
}

function start() {
  console.log(LOG_PREFIX, '🚀 Antigravity unified patch active');
  console.log(LOG_PREFIX, `   DB: ${DB_PATH}`);
  console.log(LOG_PREFIX, `   Health check interval: ${HEALTH_CHECK_INTERVAL_MS / 1000}s`);

  // Initial checks
  fixMissingProjectIds();

  // Run health check immediately
  mainLoop();

  // Schedule periodic health checks
  intervalId = setInterval(mainLoop, HEALTH_CHECK_INTERVAL_MS);
}

function stop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  console.log(LOG_PREFIX, 'Stopped');
}

// Start
start();

// Graceful shutdown
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
