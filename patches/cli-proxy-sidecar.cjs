/**
 * CLIProxyAPI Sidecar — Sync & Discovery
 * ========================================
 * Discovers CLIProxyAPI models and syncs health status.
 * Smart routing happens at the user/client level:
 *   - OmniRoute (port 20128): nvidia, gemini, xai, pollinations, combos
 *   - CLIProxyAPI (port 8317): gemini-3.1-pro, claude, antigravity Cloud Code
 *
 * Use /api/openclaw/providers to see the unified list.
 */

let cliproxyModels = new Set();
let lastSync = 0;

async function sync() {
  if (Date.now() - lastSync < 30_000) return;
  lastSync = Date.now();
  try {
    const r = await fetch("http://127.0.0.1:8317/v1/models", {
      headers: { Authorization: "Bearer omniroute-internal" },
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      const d = await r.json();
      cliproxyModels = new Set((d.data || []).map(m => m.id));
    }
  } catch {}
}

sync();
setInterval(sync, 60_000);
console.log("[cli-proxy] Sidecar sync loaded — CLIProxyAPI at localhost:8317");
