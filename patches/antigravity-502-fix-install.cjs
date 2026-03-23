'use strict';

const fs = require('fs');
const path = require('path');

const LOG_PREFIX = '[antigravity-502-fix]';

const PATCHES_DIR = path.dirname(__filename);
const OMNI_DATA_DIR = process.env.OMNI_DATA_DIR || process.env.HOME + '/.omniroute';

function findOmniRoute() {
  const possiblePaths = [
    process.env.HOME + '/.npm-global/lib/node_modules/omniroute',
    process.env.HOME + '/.omniroute/node_modules/omniroute',
    '/home/openclaw/.npm-global/lib/node_modules/omniroute',
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

function patchServerInit(omniroutePath) {
  const serverInitPath = path.join(omniroutePath, 'app/src/server-init.ts');
  
  if (!fs.existsSync(serverInitPath)) {
    console.log(LOG_PREFIX, 'server-init.ts not found, skipping patch');
    return;
  }

  let content = fs.readFileSync(serverInitPath, 'utf-8');

  if (content.includes('antigravity-502-fix')) {
    console.log(LOG_PREFIX, 'Patch already applied to server-init.ts');
    return;
  }

  const patchImport = `
import { initAntigravity502Fix } from "./patches/antigravity-502-fix.ts";
`;

  const patchCall = `
  // Antigravity 502 fix - auto-refresh on 502 errors
  try {
    initAntigravity502Fix();
  } catch (err) {
    console.warn("[ANTIGRAVITY-502-FIX] Could not initialize:", err.message);
  }
`;

  if (!content.includes(patchImport.trim())) {
    content = content.replace(
      /import \{ initConsoleInterceptor \} from ".\/lib\/consoleInterceptor";/,
      `import { initConsoleInterceptor } from "./lib/consoleInterceptor";${patchImport}`
    );
  }

  if (!content.includes('initAntigravity502Fix')) {
    content = content.replace(
      /initConsoleInterceptor\(\);/,
      `initConsoleInterceptor();${patchCall}`
    );
  }

  fs.writeFileSync(serverInitPath, content, 'utf-8');
  console.log(LOG_PREFIX, '✅ Patched server-init.ts');
}

function createPatchFile(omniroutePath) {
  const patchContent = `/**
 * Antigravity 502 Fix - Runtime Token Refresh Patch
 * =================================================
 * Auto-refreshes tokens when Antigravity returns 502 errors
 * Works with npm install AND git clone installations
 */

import { refreshGoogleToken } from "../open-sse/services/tokenRefresh.ts";
import { getProviderConnections, updateProviderConnection } from "../lib/localDb.ts";
import { HTTP_STATUS } from "../open-sse/config/constants.ts";

const LOG_PREFIX = "[antigravity-502-fix]";

// Track consecutive 502 errors per connection
const consecutiveErrors = new Map();

export function initAntigravity502Fix() {
  console.log(LOG_PREFIX, "🚀 Initializing Antigravity 502 fix...");

  patchChatCore();
  console.log(LOG_PREFIX, "✅ Antigravity 502 fix active");
}

function patchChatCore() {
  try {
    const chatCorePath = require.resolve("../open-sse/handlers/chatCore.ts");
    const chatCoreModule = require(chatCorePath);

    const originalHandleProvider = chatCoreModule.handleProviderRequest || 
                                   chatCoreModule.default?.handleProviderRequest;

    if (!originalHandleProvider) {
      console.log(LOG_PREFIX, "Could not find handleProvider function, trying alternate approach");
      patchByOverridingFetch();
      return;
    }

    chatCoreModule.handleProviderRequest = async function patchedHandleProvider(...args) {
      const result = await originalHandleProvider.apply(this, args);
      
      if (result?.providerResponse?.status === HTTP_STATUS.BAD_GATEWAY && 
          args[0]?.provider === "antigravity") {
        console.log(LOG_PREFIX, "Detected 502 for Antigravity, attempting token refresh...");
        
        await refreshAntigravityToken(args[0]?.connectionId);
      }
      
      return result;
    };

    console.log(LOG_PREFIX, "✅ Patched handleProviderRequest");
  } catch (e) {
    console.log(LOG_PREFIX, "Direct patch failed:", e.message);
    patchByOverridingFetch();
  }
}

async function refreshAntigravityToken(connectionId) {
  try {
    const connections = await getProviderConnections({ 
      provider: "antigravity",
      isActive: true 
    });

    for (const conn of connections) {
      if (!conn.refreshToken) continue;

      console.log(LOG_PREFIX, \`Refreshing token for \${conn.name}...\`);

      const result = await refreshGoogleToken(
        conn.refreshToken,
        conn.clientId || process.env.ANTIGRAVITY_CLIENT_ID,
        conn.clientSecret || process.env.ANTIGRAVITY_CLIENT_SECRET,
        console
      );

      if (result?.accessToken) {
        await updateProviderConnection(conn.id, {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken || conn.refreshToken,
          tokenExpiresAt: result.expiresIn 
            ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
            : null,
          errorCode: null,
          lastError: null,
          testStatus: "active",
        });

        console.log(LOG_PREFIX, \`✅ Token refreshed for \${conn.name}\`);
        consecutiveErrors.set(conn.id, 0);
      } else {
        const count = (consecutiveErrors.get(conn.id) || 0) + 1;
        consecutiveErrors.set(conn.id, count);
        
        if (count >= 3) {
          console.log(LOG_PREFIX, \`⚠️ \${conn.name} needs re-authentication (3 consecutive failures)\`);
          await updateProviderConnection(conn.id, {
            isActive: false,
            testStatus: "expired",
            lastError: "Token refresh failed - re-authentication required",
            errorCode: "token_refresh_failed",
          });
        }
      }
    }
  } catch (e) {
    console.error(LOG_PREFIX, "Error refreshing token:", e.message);
  }
}

function patchByOverridingFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      
      const response = await originalFetch.apply(this, arguments);
      
      if ((response.status === 502 || response.status === 401 || response.status === 403) &&
          urlString.includes('antigravity')) {
        console.log(LOG_PREFIX, \`Detected \${response.status} for Antigravity\`);
        
        setImmediate(() => refreshAntigravityToken(null));
      }
      
      return response;
    };
    
    console.log(LOG_PREFIX, "✅ Patched fetch for 502 detection");
  } catch (e) {
    console.error(LOG_PREFIX, "Fetch patch failed:", e.message);
  }
}

export default initAntigravity502Fix;
`;

  const patchesDir = path.join(omniroutePath, 'app/src/patches');
  if (!fs.existsSync(patchesDir)) {
    fs.mkdirSync(patchesDir, { recursive: true });
  }

  const patchPath = path.join(patchesDir, 'antigravity-502-fix.ts');
  fs.writeFileSync(patchPath, patchContent, 'utf-8');
  console.log(LOG_PREFIX, '✅ Created patch file:', patchPath);
}

const omniroutePath = findOmniRoute();
if (omniroutePath) {
  console.log(LOG_PREFIX, 'Found OmniRoute at:', omniroutePath);
  createPatchFile(omniroutePath);
  patchServerInit(omniroutePath);
} else {
  console.error(LOG_PREFIX, 'Could not find OmniRoute installation');
  process.exit(1);
}

console.log(LOG_PREFIX, '✅ Patch installation complete');
