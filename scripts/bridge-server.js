#!/usr/bin/env node
/**
 * Browser LLM Bridge — Standalone Server
 * Runs independently of OmniRoute on port 20130.
 * Provides OpenAI-compatible API backed by browser web UIs via Playwright CDP.
 *
 * Usage: node bridge-server.js
 * PM2:   pm2 start bridge-server.js --name browser-llm-bridge
 */
'use strict';

// Simulate __patchHooks for compatibility with the bridge patch
global.__patchHooks = {
  registerHttpMiddleware: (name, fn, opts) => {},
  registerFetchInterceptor: (name, fn, opts) => {},
};

// Load the bridge patch
require('/home/openclaw/.omniroute/patches/browser-llm-bridge.cjs');

console.log('[bridge-server] ✅ Standalone bridge server started');
console.log('[bridge-server] Port: 20130');
console.log('[bridge-server] CDP:  http://127.0.0.1:18810');

// Keep process alive
process.on('SIGINT', () => { console.log('[bridge-server] Shutting down'); process.exit(0); });
process.on('SIGTERM', () => { console.log('[bridge-server] Shutting down'); process.exit(0); });
