/**
 * OpenClaw Patch Hooks — Centralized Middleware System
 * =====================================================
 * Patches http.createServer and globalThis.fetch EXACTLY ONCE,
 * then dispatches to all registered middleware/interceptors.
 *
 * WHY: Multiple patches independently overriding these functions
 * causes only the last-loaded patch to work. This module solves
 * that by providing a single registration point.
 *
 * LOAD ORDER: This file MUST load before all other patches.
 * The "000-" prefix ensures alphabetical-first loading.
 *
 * Usage (from other patches):
 *   global.__patchHooks.registerHttpMiddleware('my-patch', (req, res, next) => { ... });
 *   global.__patchHooks.registerFetchInterceptor('my-patch', async (url, options, next) => { ... });
 */

'use strict';

const LOG_PREFIX = '[patch-hooks]';

// ── Singleton guard ──────────────────────────────────────────────────────────

if (global.__patchHooks) {
  console.log(LOG_PREFIX, '⚠ Already initialized, skipping duplicate load');
  return;
}

// ── Registry ─────────────────────────────────────────────────────────────────

const httpMiddlewares = [];   // { name, handler: (req, res, next) => void }
const fetchInterceptors = []; // { name, handler: async (url, options, next) => Response }

/**
 * Register an HTTP middleware.
 * handler signature: (req, res, next) => void
 *   - Call next() to pass to the next middleware / original listener
 *   - If you handle the request fully (wrote headers + ended response), don't call next()
 *
 * @param {string} name — unique name for debugging
 * @param {Function} handler — middleware function
 * @param {Object} [opts] — { priority: number } lower = runs first, default 100
 */
function registerHttpMiddleware(name, handler, opts = {}) {
  const priority = opts.priority || 100;
  httpMiddlewares.push({ name, handler, priority });
  httpMiddlewares.sort((a, b) => a.priority - b.priority);
  console.log(LOG_PREFIX, `📌 HTTP middleware registered: ${name} (priority ${priority}, total ${httpMiddlewares.length})`);
}

/**
 * Register a fetch interceptor.
 * handler signature: async (url, options, next) => Response
 *   - Call next(url, options) to pass to the next interceptor / original fetch
 *   - Return a Response to short-circuit the chain
 *
 * @param {string} name — unique name for debugging
 * @param {Function} handler — interceptor function
 * @param {Object} [opts] — { priority: number } lower = runs first, default 100
 */
function registerFetchInterceptor(name, handler, opts = {}) {
  const priority = opts.priority || 100;
  fetchInterceptors.push({ name, handler, priority });
  fetchInterceptors.sort((a, b) => a.priority - b.priority);
  console.log(LOG_PREFIX, `📌 Fetch interceptor registered: ${name} (priority ${priority}, total ${fetchInterceptors.length})`);
}

/**
 * Get diagnostic info about registered hooks
 */
function getRegisteredHooks() {
  return {
    http: httpMiddlewares.map(m => ({ name: m.name, priority: m.priority })),
    fetch: fetchInterceptors.map(m => ({ name: m.name, priority: m.priority })),
  };
}

// ── HTTP Server Patch ────────────────────────────────────────────────────────

function patchHttpCreateServer() {
  const http = require('http');
  const originalCreateServer = http.createServer;

  http.createServer = function hookedCreateServer(options, listener) {
    // Handle both (listener) and (options, listener) signatures
    if (typeof options === 'function') {
      listener = options;
      options = {};
    }

    const hookedListener = function hookedListener(req, res) {
      // Build the middleware chain
      let idx = 0;

      function next() {
        if (idx < httpMiddlewares.length) {
          const mw = httpMiddlewares[idx++];
          try {
            mw.handler(req, res, next);
          } catch (err) {
            console.error(LOG_PREFIX, `HTTP middleware '${mw.name}' threw:`, err.message);
            next(); // Skip broken middleware, continue chain
          }
        } else {
          // End of middleware chain — call original listener
          listener.call(this, req, res);
        }
      }

      next();
    };

    return originalCreateServer.call(this, options, hookedListener);
  };

  console.log(LOG_PREFIX, '✅ http.createServer patched (middleware chain)');
}

// ── Fetch Patch ──────────────────────────────────────────────────────────────

function patchGlobalFetch() {
  const originalFetch = globalThis.fetch;

  if (!originalFetch) {
    console.warn(LOG_PREFIX, '⚠ globalThis.fetch not available, skipping fetch patch');
    return;
  }

  globalThis.fetch = async function hookedFetch(url, options = {}) {
    // Build the interceptor chain
    let idx = 0;

    async function next(passedUrl, passedOptions) {
      if (idx < fetchInterceptors.length) {
        const interceptor = fetchInterceptors[idx++];
        try {
          return await interceptor.handler(passedUrl, passedOptions, next);
        } catch (err) {
          console.error(LOG_PREFIX, `Fetch interceptor '${interceptor.name}' threw:`, err.message);
          return next(passedUrl, passedOptions); // Skip broken interceptor
        }
      } else {
        // End of interceptor chain — call original fetch
        return originalFetch.call(globalThis, passedUrl, passedOptions);
      }
    }

    return next(url, options);
  };

  console.log(LOG_PREFIX, '✅ globalThis.fetch patched (interceptor chain)');
}

// ── Diagnostics Endpoint ─────────────────────────────────────────────────────

// Self-register a low-priority middleware for diagnostics
registerHttpMiddleware('patch-hooks-diagnostics', (req, res, next) => {
  if (req.url === '/api/patch-hooks/status' && req.method === 'GET') {
    const info = getRegisteredHooks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'active',
      httpMiddlewares: info.http,
      fetchInterceptors: info.fetch,
      totalMiddlewares: info.http.length,
      totalInterceptors: info.fetch.length,
    }, null, 2));
    return; // Don't call next — we handled it
  }
  next();
}, { priority: 999 }); // Very low priority so it runs last

// ── Auto-load neighboring patches ───────────────────────────────────────────

function loadNeighboringPatches() {
  const fs = require('fs');
  const path = require('path');

  // When loaded via --require, __dirname points to the directory of this file
  const patchesDir = __dirname;

  console.log(LOG_PREFIX, `🔍 Scanning for sibling patches in: ${patchesDir}`);

  try {
    const files = fs.readdirSync(patchesDir);
    const patches = files
      .filter(f => f.endsWith('.cjs') && f !== '000-patch-hooks.cjs')
      .sort(); // Load in alphabetical order

    console.log(LOG_PREFIX, `📦 Found ${patches.length} sibling patch(es) to load`);

    // Use eval('require') to be safe across different environments/bundlers
    const dynamicRequire = eval("require");

    for (const file of patches) {
      const fullPath = path.join(patchesDir, file);
      try {
        console.log(LOG_PREFIX, `🚀 Loading patch: ${file}`);
        dynamicRequire(fullPath);
      } catch (err) {
        console.error(LOG_PREFIX, `❌ Failed to load patch '${file}':`, err.message);
      }
    }
  } catch (err) {
    console.error(LOG_PREFIX, '❌ Failed to scan patches directory:', err.message);
  }
}

// ── Initialize ───────────────────────────────────────────────────────────────

patchHttpCreateServer();
patchGlobalFetch();

// ── Export globally ──────────────────────────────────────────────────────────

global.__patchHooks = {
  registerHttpMiddleware,
  registerFetchInterceptor,
  getRegisteredHooks,
};

console.log(LOG_PREFIX, '🚀 Centralized patch hooks active (preloaded)');

// Trigger auto-load of siblings
loadNeighboringPatches();

console.log(LOG_PREFIX, '✨ Patch orchestration complete');
console.log(LOG_PREFIX, '   GET /api/patch-hooks/status — view registered hooks');
