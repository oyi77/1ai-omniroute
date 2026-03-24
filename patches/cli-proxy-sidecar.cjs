/**
 * CLIProxyAPI Sidecar Patch
 * =========================
 * Syncs CLIProxyAPI models on startup and periodically.
 * Actual routing happens through CLIProxyAPI at localhost:8317.
 *
 * Direct access: curl -X POST http://localhost:8317/v1/chat/completions \
 *   -H "Authorization: Bearer omniroute-internal" \
 *   -d '{"model":"gemini-3.1-pro-high","messages":[{"role":"user","content":"Hi"}]}'
 */

let cliproxyModels = new Set();
let lastSync = 0;

async function syncModels() {
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
      if (cliproxyModels.size > 0) {
        const models = Array.from(cliproxyModels).join(", ");
        console.log(`[cli-proxy] ${cliproxyModels.size} models available: ${models}`);
      }
    }
  } catch {}
}

syncModels();
setInterval(syncModels, 60_000);
console.log("[cli-proxy] Sidecar sync loaded — CLIProxyAPI at localhost:8317");
