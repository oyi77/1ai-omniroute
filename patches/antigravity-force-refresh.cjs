'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[antigravity-force-refresh]';

console.log(LOG_PREFIX, 'Starting Antigravity force refresh patch...');

function findAndPatchExecutor() {
  const possiblePaths = [
    process.env.HOME + '/.npm-global/lib/node_modules/omniroute/app/open-sse/executors/antigravity.ts',
    process.env.HOME + '/.omniroute/node_modules/omniroute/app/open-sse/executors/antigravity.ts',
    '/home/openclaw/.npm-global/lib/node_modules/omniroute/app/open-sse/executors/antigravity.ts',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      console.log(LOG_PREFIX, 'Found executor at:', p);
      return p;
    }
  }
  
  const searchDir = process.env.HOME + '/.npm-global/lib/node_modules/omniroute/app';
  if (fs.existsSync(searchDir)) {
    try {
      const entries = fs.readdirSync(searchDir + '/open-sse/executors', { withFileTypes: true });
      for (const e of entries) {
        if (e.name.includes('antigravity')) {
          const fullPath = searchDir + '/open-sse/executors/' + e.name;
          console.log(LOG_PREFIX, 'Found executor at:', fullPath);
          return fullPath;
        }
      }
    } catch (e) {
      console.log(LOG_PREFIX, 'Error searching:', e.message);
    }
  }
  
  return null;
}

function addRefreshLogic(executorPath) {
  try {
    let content = fs.readFileSync(executorPath, 'utf-8');
    
    if (content.includes('FORCE_TOKEN_REFRESH')) {
      console.log(LOG_PREFIX, 'Patch already applied');
      return;
    }

    const refreshImport = `
// FORCE_TOKEN_REFRESH - Auto refresh tokens on 401/403/502 errors
import { refreshAccessToken } from "../services/tokenRefresh.ts";
import { getProviderConnections, updateProviderConnection } from "../lib/localDb.ts";

async function forceRefreshToken(connectionId, provider, refreshToken, credentials) {
  try {
    const result = await refreshAccessToken(provider, refreshToken, credentials, console);
    if (result && result.accessToken) {
      await updateProviderConnection(connectionId, {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_expires_at: result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000).toISOString() : null,
        error_code: null,
        last_error: null,
      });
      console.log("[FORCE_REFRESH] Successfully refreshed token for", connectionId);
      return result.accessToken;
    }
  } catch (e) {
    console.error("[FORCE_REFRESH] Failed to refresh token:", e.message);
  }
  return null;
}
`;

    const hookCode = `
// Check for auth errors and trigger refresh
if (response.status === 401 || response.status === 403 || response.status === 502) {
  const conn = getProviderConnections().find(c => c.id === connectionId);
  if (conn?.refresh_token) {
    console.log("[FORCE_REFRESH] Detected", response.status, "error, attempting token refresh...");
    const newToken = await forceRefreshToken(connectionId, 'antigravity', conn.refresh_token, credentials);
    if (newToken) {
      headers['Authorization'] = \`Bearer \${newToken}\`;
      const retryResponse = await fetch(url, { ...options, headers });
      return retryResponse;
    }
  }
}
`;

    if (!content.includes(refreshImport.substring(0, 50))) {
      content = refreshImport + '\n' + content;
    }

    fs.writeFileSync(executorPath, content, 'utf-8');
    console.log(LOG_PREFIX, 'Successfully patched executor for force refresh');
    
  } catch (e) {
    console.error(LOG_PREFIX, 'Error patching executor:', e.message);
  }
}

const executorPath = findAndPatchExecutor();
if (executorPath) {
  addRefreshLogic(executorPath);
} else {
  console.log(LOG_PREFIX, 'Could not find Antigravity executor to patch');
}

console.log(LOG_PREFIX, 'Patch initialization complete');