'use strict';

var fs = require('fs');
var path = require('path');

const LOG_PREFIX = '[antigravity-token-refresh]';

console.log(LOG_PREFIX, 'Starting Antigravity token refresh patch...');

function getStoragePath() {
  const homedir = require('os').homedir();
  return path.join(homedir, '.omniroute', 'storage.sqlite');
}

function getProviderConnections() {
  try {
    const storagePath = getStoragePath();
    if (!fs.existsSync(storagePath)) {
      console.log(LOG_PREFIX, 'Storage file not found');
      return [];
    }
    
    const Database = require('better-sqlite3');
    const db = new Database(storagePath, { readonly: true });
    
    const rows = db.prepare(`
      SELECT id, provider, name, access_token, refresh_token, expires_at, token_expires_at, error_code
      FROM provider_connections 
      WHERE provider = 'antigravity' 
        AND is_active = 1
        AND (
          token_expires_at IS NULL 
          OR token_expires_at <= datetime('now')
          OR error_code IN ('401', '403', '502')
        )
    `).all();
    
    db.close();
    return rows;
  } catch (e) {
    console.error(LOG_PREFIX, 'Error reading provider connections:', e.message);
    return [];
  }
}

function checkTokenExpiry(tokenExpiresAt) {
  if (!tokenExpiresAt) return true;
  const expiryDate = new Date(tokenExpiresAt);
  const now = new Date();
  return expiryDate <= now;
}

async function refreshToken(connection) {
  if (!connection.refresh_token) {
    console.log(LOG_PREFIX, `No refresh token for ${connection.name}, needs re-auth`);
    return null;
  }
  
  try {
    const ANTIGRAVITY_CONFIG = {
      clientId: process.env.ANTIGRAVITY_CLIENT_ID || '773662819365-l7uir3lj1d8t1gk6c9j1k4kd8f4t8p4u.apps.googleusercontent.com',
      clientSecret: process.env.ANTIGRAVITY_CLIENT_SECRET || ''GOCSPX-PLACEHOLDER'',
      tokenUrl: 'https://oauth2.googleapis.com/token',
    };
    
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: connection.refresh_token,
      client_id: ANTIGRAVITY_CONFIG.clientId,
      client_secret: ANTIGRAVITY_CONFIG.clientSecret,
    });
    
    const response = await fetch(ANTIGRAVITY_CONFIG.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: params,
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(LOG_PREFIX, `Token refresh failed for ${connection.name}:`, response.status, errorText);
      return null;
    }
    
    const tokens = await response.json();
    console.log(LOG_PREFIX, `Token refreshed successfully for ${connection.name}`);
    
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || connection.refresh_token,
      expiresIn: tokens.expires_in,
    };
  } catch (e) {
    console.error(LOG_PREFIX, `Error refreshing token for ${connection.name}:`, e.message);
    return null;
  }
}

async function processConnections() {
  console.log(LOG_PREFIX, 'Checking Antigravity connections for token refresh...');
  
  const connections = getProviderConnections();
  console.log(LOG_PREFIX, `Found ${connections.length} connections needing attention`);
  
  let refreshed = 0;
  let failed = 0;
  
  for (const conn of connections) {
    const needsRefresh = checkTokenExpiry(conn.token_expires_at) || 
                         ['401', '403', '502'].includes(String(conn.error_code));
    
    if (needsRefresh && conn.refresh_token) {
      console.log(LOG_PREFIX, `Refreshing token for ${conn.name}...`);
      const result = await refreshToken(conn);
      if (result) {
        refreshed++;
      } else {
        failed++;
      }
    } else if (!conn.refresh_token) {
      console.log(LOG_PREFIX, `Connection ${conn.name} has no refresh token - needs re-auth`);
      failed++;
    }
  }
  
  console.log(LOG_PREFIX, `Summary: ${refreshed} refreshed, ${failed} failed/needs re-auth`);
}

processConnections().then(() => {
  console.log(LOG_PREFIX, 'Token refresh check complete');
}).catch(e => {
  console.error(LOG_PREFIX, 'Error:', e);
});