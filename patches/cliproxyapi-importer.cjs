/**
 * CLIProxyAPI Account Importer
 * =============================
 * Imports accounts from CLIProxyAPI JSON credential files to OmniRoute.
 * Syncs new accounts and updates existing ones.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const LOG_PREFIX = '[cliproxyapi-importer]';
const DATA_DIR = process.env.OMNI_DATA_DIR || path.join(os.homedir(), '.omniroute');
const DB_PATH = path.join(DATA_DIR, 'storage.sqlite');
const AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api');
const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

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

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
}

function findConnectionByToken(accessToken) {
  const db = getDb();
  if (!db) return null;
  try {
    // Access tokens are encrypted, so we can't match directly
    // Instead, we match by the hash suffix stored in connection ID
    return null; // Will use upsert by ID
  } finally {
    db.close();
  }
}

function upsertConnection(conn) {
  const db = getDb();
  if (!db) return false;
  try {
    const now = new Date().toISOString();
    
    // Check if exists
    const existing = db.prepare('SELECT id FROM provider_connections WHERE id = ?').get(conn.id);
    
    if (existing) {
      // Update existing
      db.prepare(`
        UPDATE provider_connections SET
          access_token = @accessToken,
          refresh_token = @refreshToken,
          project_id = @projectId,
          token_expires_at = @tokenExpiresAt,
          updated_at = @updatedAt,
          is_active = 1,
          test_status = 'active'
        WHERE id = @id
      `).run({
        id: conn.id,
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        projectId: conn.projectId,
        tokenExpiresAt: conn.tokenExpiresAt,
        updatedAt: now,
      });
      return 'updated';
    } else {
      // Insert new
      db.prepare(`
        INSERT INTO provider_connections (
          id, provider, auth_type, name, email, access_token, refresh_token,
          project_id, token_expires_at, is_active, test_status, created_at, updated_at
        ) VALUES (
          @id, @provider, 'oauth', @name, @email, @accessToken, @refreshToken,
          @projectId, @tokenExpiresAt, 1, 'active', @createdAt, @updatedAt
        )
      `).run({
        id: conn.id,
        provider: conn.provider,
        name: conn.email,
        email: conn.email,
        accessToken: conn.accessToken,
        refreshToken: conn.refreshToken,
        projectId: conn.projectId,
        tokenExpiresAt: conn.tokenExpiresAt,
        createdAt: now,
        updatedAt: now,
      });
      return 'inserted';
    }
  } catch (e) {
    console.error(LOG_PREFIX, 'Upsert error:', e.message);
    return false;
  } finally {
    db.close();
  }
}

// ── Import functions ──────────────────────────────────────────────────────────

function readCliProxyCredentials() {
  const credentials = [];
  
  try {
    const files = fs.readdirSync(AUTH_DIR);
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      
      try {
        const content = fs.readFileSync(path.join(AUTH_DIR, file), 'utf8');
        const cred = JSON.parse(content);
        
        // Determine provider from file name or content
        let provider = 'unknown';
        if (file.startsWith('antigravity_') || cred.type === 'antigravity') {
          provider = 'antigravity';
        } else if (file.startsWith('claude_') || cred.type === 'claude') {
          provider = 'claude';
        } else if (file.startsWith('codex_') || cred.type === 'codex') {
          provider = 'codex';
        }
        
        if (provider === 'unknown' || !cred.access_token) continue;
        
        // Generate ID from access token hash
        const tokenHash = hashToken(cred.access_token);
        const connId = `${tokenHash}-${crypto.randomUUID().slice(0, 8)}`;
        
        // Check if we already have this account (by matching existing connection)
        // For now, use the file-based ID
        const existingId = file.replace(/\.(json|yaml)$/, '').replace(/^(antigravity|claude|codex)_/, '');
        
        credentials.push({
          id: existingId.length === 8 ? existingId : tokenHash.slice(0, 8) + '-' + crypto.randomUUID().slice(0, 8),
          provider,
          email: cred.email || `${provider}-${tokenHash}`,
          accessToken: cred.access_token,
          refreshToken: cred.refresh_token,
          projectId: cred.project_id,
          tokenExpiresAt: cred.expired || (cred.expires_in ? new Date(Date.now() + cred.expires_in * 1000).toISOString() : null),
          clientId: cred.client_id,
          clientSecret: cred.client_secret,
        });
      } catch (e) {
        // Skip invalid files
      }
    }
  } catch (e) {
    console.error(LOG_PREFIX, 'Error reading CLIProxyAPI credentials:', e.message);
  }
  
  return credentials;
}

function syncFromCliProxyAPI() {
  const credentials = readCliProxyCredentials();
  
  if (credentials.length === 0) {
    console.log(LOG_PREFIX, 'No CLIProxyAPI credentials found');
    return;
  }
  
  let inserted = 0;
  let updated = 0;
  let failed = 0;
  
  for (const cred of credentials) {
    const result = upsertConnection(cred);
    if (result === 'inserted') inserted++;
    else if (result === 'updated') updated++;
    else failed++;
  }
  
  if (inserted > 0 || updated > 0) {
    console.log(LOG_PREFIX, `✅ Synced ${credentials.length} accounts: ${inserted} new, ${updated} updated, ${failed} failed`);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let intervalId = null;

function start() {
  console.log(LOG_PREFIX, '🚀 CLIProxyAPI account importer active');
  console.log(LOG_PREFIX, `   Auth dir: ${AUTH_DIR}`);
  
  // Run immediately
  syncFromCliProxyAPI();
  
  // Schedule periodic sync
  intervalId = setInterval(syncFromCliProxyAPI, SYNC_INTERVAL_MS);
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
