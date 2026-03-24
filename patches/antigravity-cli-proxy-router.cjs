/**
 * Antigravity CLIProxyAPI Router
 * ===============================
 * Provides CLIProxyAPI integration utilities for OmniRoute.
 * 
 * The actual fallback routing is injected into chatCore.ts by cli-proxy-fallback-patch.sh.
 * This module provides:
 *   - Model discovery (what models CLIProxyAPI supports for antigravity)
 *   - Health checking
 *   - Request forwarding utilities
 */

const CLI_PROXY_API = process.env.CLIPROXYAPI_URL || "http://127.0.0.1:8317";
const AUTH_TOKEN = "omniroute-internal";

let cachedModels = new Set();
let lastSync = 0;
const SYNC_INTERVAL_MS = 60_000;

async function syncModels() {
  if (Date.now() - lastSync < SYNC_INTERVAL_MS && cachedModels.size > 0) return cachedModels;
  
  try {
    const resp = await fetch(`${CLI_PROXY_API}/v1/models`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      signal: AbortSignal.timeout(5000),
    });
    
    if (resp.ok) {
      const data = await resp.json();
      cachedModels = new Set((data.data || []).map(m => m.id));
      lastSync = Date.now();
    }
  } catch (e) {
    // CLIProxyAPI might not be running — that's OK
  }
  
  return cachedModels;
}

async function isHealthy() {
  try {
    const resp = await fetch(`${CLI_PROXY_API}/v1/models`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function getAvailableModels() {
  await syncModels();
  return [...cachedModels];
}

async function supportsModel(modelName) {
  await syncModels();
  return cachedModels.has(modelName);
}

function shouldRouteThroughProxy(provider, statusCode) {
  return (
    provider === "antigravity" &&
    [502, 401, 403, 429, 503].includes(statusCode)
  );
}

module.exports = {
  CLI_PROXY_API,
  syncModels,
  isHealthy,
  getAvailableModels,
  supportsModel,
  shouldRouteThroughProxy,
};
