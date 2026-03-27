/**
 * OpenClaw Patch Manager
 * ======================
 * Adds management API for patches and CLIProxyAPI sidecar.
 *
 * Endpoints:
 *   GET  /api/openclaw/patches         — List all patches with status
 *   POST /api/openclaw/patches/toggle  — Enable/disable a patch
 *   GET  /api/openclaw/cliproxyapi     — CLIProxyAPI status
 *   POST /api/openclaw/cliproxyapi     — Start/stop/restart CLIProxyAPI
 *   POST /api/openclaw/cliproxyapi/update — Update CLIProxyAPI
 *   GET  /api/openclaw/status          — Combined status (patches + CLIProxyAPI)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');
const os = require('os');

const PATCHES_DIR = path.join(os.homedir(), '.omniroute', 'patches');
const CLI_CONFIG = path.join(os.homedir(), '.cliproxyapi-config.yaml');
const CLI_BINARY = path.join(os.homedir(), 'CLIProxyAPI', 'cli-proxy-api');
const CLI_REPO = path.join(os.homedir(), 'CLIProxyAPI');
const AUTH_DIR = path.join(os.homedir(), '.cli-proxy-api');

// ── Patch discovery ──────────────────────────────────────────────────────────

function discoverPatches() {
  try {
    const entries = fs.readdirSync(PATCHES_DIR);
    return entries
      .filter(f => f.endsWith('.cjs') || f.endsWith('.js'))
      .map(f => {
        const filePath = path.join(PATCHES_DIR, f);
        const stat = fs.statSync(filePath);
        const disabled = f.endsWith('.disabled');
        const baseName = disabled ? f.replace(/\.disabled$/, '') : f;
        const content = fs.readFileSync(filePath, 'utf8');
        const descMatch = content.match(/\*\s*\n\s*\*\s*(.+?)\n/);
        return {
          name: baseName,
          file: f,
          enabled: !disabled,
          size: stat.size,
          description: descMatch ? descMatch[1].trim().replace(/=/g, '').trim() : '',
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function togglePatch(patchName, enable) {
  const patches = discoverPatches();
  const patch = patches.find(p => p.name === patchName || p.file === patchName);
  if (!patch) return { error: `Patch not found: ${patchName}` };

  const currentPath = path.join(PATCHES_DIR, patch.file);
  if (enable && patch.file.endsWith('.disabled')) {
    const newPath = path.join(PATCHES_DIR, patch.name);
    fs.renameSync(currentPath, newPath);
    return { success: true, name: patchName, enabled: true, message: `Enabled ${patchName} (restart required)` };
  } else if (!enable && !patch.file.endsWith('.disabled')) {
    const newPath = currentPath + '.disabled';
    fs.renameSync(currentPath, newPath);
    return { success: true, name: patchName, enabled: false, message: `Disabled ${patchName} (restart required)` };
  }
  return { success: true, name: patchName, enabled: patch.enabled, message: `Already ${patch.enabled ? 'enabled' : 'disabled'}` };
}

// ── CLIProxyAPI management ───────────────────────────────────────────────────

function getCliProxyStatus() {
  try {
    const statusOut = execSync('systemctl is-active cliproxyapi 2>/dev/null || echo "inactive"', { encoding: 'utf8' }).trim();
    const isEnabled = execSync('systemctl is-enabled cliproxyapi 2>/dev/null || echo "disabled"', { encoding: 'utf8' }).trim();
    let version = 'unknown';
    if (fs.existsSync(CLI_BINARY)) {
      try {
        const out = execSync(`"${CLI_BINARY}" --help 2>&1 | grep "CLIProxyAPI Version:"`, { encoding: 'utf8', timeout: 2000 }).trim();
        version = out.replace('CLIProxyAPI Version: ', '').split(',')[0];
        if (version === 'dev' || !version) version = '3.0.0-code'; // User requested "code version"
      } catch (e) {
        version = '3.0.0-code (fallback)';
      }
    }
    let latestVersion = 'unknown';
    try {
      latestVersion = execSync('curl -s https://api.github.com/repos/router-for-me/CLIProxyAPI/releases/latest 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get(\'tag_name\',\'unknown\'))" 2>/dev/null', { encoding: 'utf8', timeout: 10000 }).trim();
    } catch { }

    let modelCount = 0;
    try {
      const resp = execSync('curl -s http://127.0.0.1:8317/v1/models -H "Authorization: Bearer omniroute-internal" 2>/dev/null', { encoding: 'utf8', timeout: 5000 });
      const data = JSON.parse(resp);
      modelCount = (data.data || []).length;
    } catch { }

    let authCount = 0;
    try {
      authCount = fs.readdirSync(AUTH_DIR).filter(f => f.endsWith('.json')).length;
    } catch { }

    return {
      installed: fs.existsSync(CLI_BINARY),
      running: statusOut === 'active',
      enabled: isEnabled === 'enabled',
      version,
      latestVersion,
      modelCount,
      authCount,
      port: 8317,
    };
  } catch (e) {
    return { installed: false, running: false, error: e.message };
  }
}

function manageCliProxy(action) {
  try {
    switch (action) {
      case 'start':
        execSync('sudo systemctl start cliproxyapi', { encoding: 'utf8' });
        break;
      case 'stop':
        execSync('sudo systemctl stop cliproxyapi', { encoding: 'utf8' });
        break;
      case 'restart':
        execSync('sudo systemctl restart cliproxyapi', { encoding: 'utf8' });
        break;
      case 'enable':
        execSync('sudo systemctl enable cliproxyapi', { encoding: 'utf8' });
        break;
      case 'disable':
        execSync('sudo systemctl disable cliproxyapi', { encoding: 'utf8' });
        break;
      default:
        return { error: `Unknown action: ${action}` };
    }
    return { success: true, action, status: getCliProxyStatus() };
  } catch (e) {
    return { error: e.message };
  }
}

function updateCliProxy() {
  try {
    if (!fs.existsSync(CLI_REPO)) return { error: 'CLIProxyAPI repo not found at ' + CLI_REPO };
    execSync(`cd "${CLI_REPO}" && git pull --ff-only 2>&1`, { encoding: 'utf8', timeout: 60000 });
    execSync(`cd "${CLI_REPO}" && go build -o cli-proxy-api ./cmd/server/ 2>&1`, { encoding: 'utf8', timeout: 120000 });
    execSync('sudo systemctl restart cliproxyapi', { encoding: 'utf8' });
    return { success: true, message: 'CLIProxyAPI updated and restarted', status: getCliProxyStatus() };
  } catch (e) {
    return { error: e.message };
  }
}

function syncAuthToCliProxy() {
  try {
    const syncScript = path.join(os.homedir(), '1ai-omniroute', 'scripts', 'sync-auth-to-cliproxyapi.py');
    if (fs.existsSync(syncScript)) {
      execSync(`python3 "${syncScript}"`, { encoding: 'utf8', timeout: 30000 });
      execSync('sudo systemctl restart cliproxyapi', { encoding: 'utf8' });
      return { success: true, message: 'Auth synced and CLIProxyAPI restarted' };
    }
    return { error: 'Sync script not found' };
  } catch (e) {
    return { error: e.message };
  }
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

function handlePatchManagerRequest(req, res, body) {
  const url = req.url.split('?')[0];
  const method = req.method;

  // Patches list
  if (url === '/api/openclaw/patches' && method === 'GET') {
    const patches = discoverPatches();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ patches, total: patches.length, enabled: patches.filter(p => p.enabled).length }));
    return true;
  }

  // Toggle patch
  if (url === '/api/openclaw/patches/toggle' && method === 'POST') {
    const { name, enabled } = body || {};
    if (!name) { res.writeHead(400); res.end('{"error":"name required"}'); return true; }
    const result = togglePatch(name, enabled !== false);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // CLIProxyAPI status
  if (url === '/api/openclaw/cliproxyapi' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getCliProxyStatus()));
    return true;
  }

  // OmniRoute Check Update
  if (url === '/api/openclaw/omniroute/check-update' && method === 'GET') {
    (async () => {
      try {
        const repoPath = '/home/openclaw/omniroute-src';
        const currentVersion = (() => {
          try { return JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8')).version; } catch { return '3.0.0'; }
        })();

        // Fetch latest version from GitHub or remote
        let latestVersion = currentVersion;
        try {
          const resp = execSync('curl -s https://api.github.com/repos/router-for-me/omniroute/releases/latest | grep tag_name | cut -d : -f 2,3 | tr -d \\\\" ,', { encoding: 'utf8', timeout: 5000 }).trim();
          if (resp && resp !== 'null') latestVersion = resp.replace(/^v/, '');
        } catch { }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          current: currentVersion,
          latest: latestVersion,
          updateAvailable: currentVersion !== latestVersion
        }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // OmniRoute Perform Update (Streaming Logs)
  if (url === '/api/openclaw/omniroute/update' && method === 'POST') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const send = (log, progress) => {
      res.write(JSON.stringify({ log, progress }) + '\n');
    };

    (async () => {
      try {
        const repoPath = '/home/openclaw/omniroute-src';
        send("Initalizing update...", 5);

        send("Pulling latest changes from main...", 20);
        execSync(`cd ${repoPath} && git pull origin main`, { encoding: 'utf8' });

        send("Installing dependencies (pnpm)...", 40);
        execSync(`cd ${repoPath} && pnpm install --frozen-lockfile`, { encoding: 'utf8' });

        send("Rebuilding application...", 70);
        execSync(`cd ${repoPath} && pnpm build`, { encoding: 'utf8' });

        send("Update completed successfully! System will restart in few seconds.", 95);
        send("Done", 100);
        res.end();

        // Trigger restart
        setTimeout(() => {
          exec('pm2 restart omniroute || sudo systemctl restart omniroute');
        }, 2000);
      } catch (e) {
        send(`Error: ${e.message}`, 0);
        res.end();
      }
    })();
    return true;
  }

  // CLIProxyAPI management
  if (url === '/api/openclaw/cliproxyapi' && method === 'POST') {
    const { action } = body || {};
    if (!action) { res.writeHead(400); res.end('{"error":"action required"}'); return true; }
    const result = manageCliProxy(action);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // CLIProxyAPI update
  if (url === '/api/openclaw/cliproxyapi/update' && method === 'POST') {
    const result = updateCliProxy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // Sync auth to CLIProxyAPI
  if (url === '/api/openclaw/cliproxyapi/sync' && method === 'POST') {
    const result = syncAuthToCliProxy();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
    return true;
  }

  // Combined providers list (OmniRoute + CLIProxyAPI)
  if (url === '/api/openclaw/providers' && method === 'GET') {
    try {
      // Get OmniRoute providers from SQLite
      const dbPath = path.join(os.homedir(), '.omniroute', 'storage.sqlite');
      const result = execSync(
        `sqlite3 "${dbPath}" "SELECT provider, COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active, SUM(CASE WHEN error_code IS NOT NULL AND error_code != '' THEN 1 ELSE 0 END) as errors FROM provider_connections GROUP BY provider ORDER BY provider;"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();

      const omniroute = [];
      for (const line of result.split('\n')) {
        const [provider, total, active, errors] = line.split('|');
        const t = parseInt(total), a = parseInt(active), e = parseInt(errors);
        omniroute.push({
          provider,
          source: 'omniroute',
          total: t,
          active: a,
          errors: e,
          healthy: a > 0 && (e / Math.max(a, 1)) < 0.3,
        });
      }

      // Get CLIProxyAPI models
      let cliproxyapi = [];
      try {
        const resp = execSync(
          `curl -s http://127.0.0.1:8317/v1/models -H "Authorization: Bearer omniroute-internal" 2>/dev/null`,
          { encoding: 'utf8', timeout: 5000 }
        );
        const data = JSON.parse(resp);
        const models = data.data || [];

        // Group by provider
        const providerMap = {};
        for (const m of models) {
          let prov = 'unknown';
          if (m.id.startsWith('gemini-3.1') || m.id.startsWith('gemini-3-pro')) prov = 'antigravity';
          else if (m.id.startsWith('claude-')) prov = 'claude';
          else if (m.id.startsWith('gpt-')) prov = 'openai';
          else if (m.id.startsWith('gemini-')) prov = 'gemini-cli';
          if (!providerMap[prov]) providerMap[prov] = [];
          providerMap[prov].push(m.id);
        }
        for (const [prov, mods] of Object.entries(providerMap)) {
          cliproxyapi.push({
            provider: prov,
            source: 'cliproxyapi',
            models: mods,
            healthy: true,
          });
        }
      } catch { }

      // Merge: show unique providers from both sources
      const merged = {};
      for (const p of omniroute) {
        merged[p.provider] = { ...p, cliproxyapi: null };
      }
      for (const p of cliproxyapi) {
        if (merged[p.provider]) {
          merged[p.provider].cliproxyapi = p;
          merged[p.provider].source = 'both';
        } else {
          merged[p.provider] = { ...p, omniroute: null };
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        providers: Object.values(merged),
        total: Object.keys(merged).length,
        omnirouteCount: omniroute.length,
        cliproxyapiCount: cliproxyapi.length,
      }));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // Combined status
  if (url === '/api/openclaw/status' && method === 'GET') {
    const patches = discoverPatches();
    const cliproxy = getCliProxyStatus();
    const omnirouteVersion = (() => {
      try { return require(path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'omniroute', 'package.json')).version; } catch { return 'unknown'; }
    })();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version: omnirouteVersion,
      patched: patches.filter(p => p.enabled).length > 0,
      patchCount: patches.filter(p => p.enabled).length,
      patches,
      cliproxyapi: cliproxy,
    }));
    return true;
  }

  // Serve dashboard
  if ((url === '/api/openclaw' || url === '/api/openclaw/') && method === 'GET') {
    const dashPath = path.join(os.homedir(), '1ai-omniroute', 'src', 'code', 'dashboard', 'patch-manager.html');
    try {
      const html = fs.readFileSync(dashPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch {
      res.writeHead(404);
      res.end('Dashboard not found');
    }
    return true;
  }

  return false;
}

// ── HTTP Middleware Registration ──────────────────────────────────────────────

function patchManagerMiddleware(req, res, next) {
  if (req.url && req.url.startsWith('/api/openclaw/')) {
    if (req.method === 'GET') {
      if (handlePatchManagerRequest(req, res, null)) return; // Handled, don't call next
    } else if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch { }
        if (handlePatchManagerRequest(req, res, parsed)) return; // Handled
        next(); // Not handled, pass through
      });
      return; // Wait for body to finish
    }
  }
  next();
}

if (global.__patchHooks) {
  // Priority 50 — run after URL rewriting but before generic middleware
  global.__patchHooks.registerHttpMiddleware('patch-manager', patchManagerMiddleware, { priority: 50 });
  console.log('[openclaw-patch-manager] ✅ Registered via patch-hooks — /api/openclaw/* endpoints active');
} else {
  console.error('[openclaw-patch-manager] ✖ patch-hooks not loaded — patch-manager will not work');
}
