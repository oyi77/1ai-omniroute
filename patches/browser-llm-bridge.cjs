/**
 * Browser LLM Bridge — OmniRoute Patch
 * =====================================
 * Starts a local HTTP server on port 20130 that exposes an
 * OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Routes requests to browser web UIs via Playwright CDP:
 *   web/claude   → claude.ai
 *   web/deepseek → chat.deepseek.com
 *   web/gemini   → gemini.google.com/app
 *
 * CDP browser assumed running at port 18810.
 * Browser sessions must already be logged in.
 *
 * LOAD ORDER: Loaded automatically by 000-patch-hooks.cjs
 */

'use strict';

const http = require('http');
const { randomUUID } = require('crypto');

const LOG = '[browser-llm-bridge]';
const BRIDGE_PORT = 20130;
const CDP_PORT = 18810;

// ── Singleton guard ──────────────────────────────────────────────────────────
if (global.__browserLlmBridge) {
  console.log(LOG, '⚠ Already initialized, skipping');
  return;
}
global.__browserLlmBridge = true;

// ── Playwright availability check ────────────────────────────────────────────
let playwright = null;
try {
  playwright = require('playwright');
  console.log(LOG, '✅ playwright loaded');
} catch (e) {
  try {
    playwright = require('/home/openclaw/.npm-global/lib/node_modules/playwright');
    console.log(LOG, '✅ playwright loaded from global');
  } catch (e2) {
    console.warn(LOG, '⚠ playwright not available — bridge will return errors');
  }
}

// ── Platform configs ─────────────────────────────────────────────────────────
const PLATFORMS = {
  'web/claude': {
    name: 'Claude',
    urlPattern: 'claude.ai',
    landingUrl: 'https://claude.ai/new',
    inputSelector: '[contenteditable="true"], div[data-placeholder], textarea',
    sendSelector: 'button[aria-label*="Send"], button[type="submit"]',
    responseSelector: '.font-claude-message, [data-testid="assistant-message"] .whitespace-pre-wrap',
    stopSelector: 'button[aria-label*="Stop"]',
    newChatUrl: 'https://claude.ai/new',
  },
  'web/deepseek': {
    name: 'DeepSeek',
    urlPattern: 'chat.deepseek.com',
    landingUrl: 'https://chat.deepseek.com',
    inputSelector: 'textarea, #chat-input',
    sendSelector: 'button[aria-label*="Send"], div[role="button"][aria-label*="send"]',
    responseSelector: '.ds-markdown, .message-content .markdown',
    stopSelector: 'button[aria-label*="Stop"]',
    newChatUrl: 'https://chat.deepseek.com',
  },
  'web/gemini': {
    name: 'Gemini',
    urlPattern: 'gemini.google.com',
    landingUrl: 'https://gemini.google.com/app',
    inputSelector: 'rich-textarea .ql-editor, textarea[aria-label*="message"], p[data-placeholder]',
    sendSelector: 'button[aria-label*="Send message"], mat-icon[data-mat-icon-name="send"]',
    responseSelector: 'model-response .markdown, .response-content',
    stopSelector: 'button[aria-label*="Stop"]',
    newChatUrl: 'https://gemini.google.com/app',
  },
};

// ── Browser session management ───────────────────────────────────────────────
let _browser = null;
let _connectAttempts = 0;

async function getBrowser() {
  if (_browser) {
    try {
      // Quick health check
      _browser.contexts();
      return _browser;
    } catch (e) {
      _browser = null;
    }
  }

  if (!playwright) throw new Error('playwright not available');

  _connectAttempts++;
  console.log(LOG, `Connecting to CDP at port ${CDP_PORT} (attempt ${_connectAttempts})...`);
  _browser = await playwright.chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  console.log(LOG, '✅ Connected to browser via CDP');
  return _browser;
}

async function getPlatformPage(platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) throw new Error(`Unknown platform: ${platform}`);

  const browser = await getBrowser();
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('No browser contexts found — is browser running?');

  const ctx = contexts[0];
  const pages = ctx.pages();

  // Find existing tab for this platform
  for (const page of pages) {
    const url = page.url();
    if (url.includes(cfg.urlPattern)) {
      console.log(LOG, `♻ Reusing existing tab for ${cfg.name}: ${url}`);
      return page;
    }
  }

  // Open a new tab for this platform
  console.log(LOG, `📂 Opening new tab for ${cfg.name}`);
  const page = await ctx.newPage();
  await page.goto(cfg.newChatUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  return page;
}

// ── Core: send message and get response ─────────────────────────────────────
async function sendMessage(platform, userMessage) {
  const cfg = PLATFORMS[platform];
  const page = await getPlatformPage(platform);

  // Navigate to new chat if page looks like a conversation
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('/new') && !currentUrl.includes('/app') && currentUrl !== cfg.landingUrl) {
      // Might be mid-conversation — navigate to new chat
      await page.goto(cfg.newChatUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);
    }
  } catch (_) {}

  // Find input
  let inputEl = null;
  const inputSelectors = cfg.inputSelector.split(', ');
  for (const sel of inputSelectors) {
    try {
      inputEl = await page.waitForSelector(sel, { timeout: 5000 });
      if (inputEl) break;
    } catch (_) {}
  }

  if (!inputEl) {
    throw new Error(`Could not find input field on ${cfg.name}. Session may have expired.`);
  }

  // Clear and type message
  await inputEl.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type(userMessage, { delay: 10 });
  await page.waitForTimeout(300);

  // Capture existing response count (to detect new response)
  const getResponseText = async () => {
    const selectors = cfg.responseSelector.split(', ');
    for (const sel of selectors) {
      try {
        const elements = await page.$$(sel);
        if (elements.length > 0) {
          const last = elements[elements.length - 1];
          return await last.innerText();
        }
      } catch (_) {}
    }
    return '';
  };

  const beforeText = await getResponseText();

  // Send message (Enter or button)
  try {
    const sendSelectors = cfg.sendSelector.split(', ');
    let sent = false;
    for (const sel of sendSelectors) {
      try {
        const btn = await page.$(sel);
        if (btn) {
          await btn.click();
          sent = true;
          break;
        }
      } catch (_) {}
    }
    if (!sent) {
      await page.keyboard.press('Enter');
    }
  } catch (_) {
    await page.keyboard.press('Enter');
  }

  // Wait for response to appear and complete
  console.log(LOG, `⏳ Waiting for ${cfg.name} response...`);

  let responseText = '';
  let lastText = '';
  let stableCount = 0;
  const maxWait = 120000; // 2 min max
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await page.waitForTimeout(500);

    const currentText = await getResponseText();

    // Check if we got new content
    if (currentText && currentText !== beforeText) {
      if (currentText === lastText) {
        stableCount++;
        if (stableCount >= 6) {
          // Text stable for 3 seconds — response complete
          responseText = currentText;
          break;
        }
      } else {
        lastText = currentText;
        stableCount = 0;
      }
    }

    // Check if stop button disappeared (generation done)
    const stopSelectors = cfg.stopSelector.split(', ');
    let generating = false;
    for (const sel of stopSelectors) {
      try {
        const stopBtn = await page.$(sel);
        if (stopBtn) {
          generating = true;
          stableCount = 0; // Reset if still generating
          break;
        }
      } catch (_) {}
    }

    if (!generating && lastText && lastText !== beforeText) {
      stableCount++;
      if (stableCount >= 4) {
        responseText = lastText;
        break;
      }
    }
  }

  if (!responseText) {
    throw new Error(`Timeout waiting for response from ${cfg.name} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  }

  console.log(LOG, `✅ Got response from ${cfg.name} (${responseText.length} chars)`);
  return responseText;
}

// ── OpenAI-compatible response builders ──────────────────────────────────────
function buildCompletion(model, content) {
  return {
    id: `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: content.split(' ').length,
      total_tokens: content.split(' ').length,
    },
  };
}

function buildStreamChunk(id, model, delta, finish = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      delta: finish ? {} : { role: 'assistant', content: delta },
      finish_reason: finish,
    }],
  })}\n\n`;
}

// ── HTTP server ──────────────────────────────────────────────────────────────
function extractMessages(body) {
  const msgs = body.messages || [];
  // Combine all user messages
  const last = msgs.filter(m => m.role === 'user').pop();
  return last ? last.content : '';
}

function startBridgeServer() {
  const server = http.createServer(async (req, res) => {
    const url = req.url;
    const method = req.method;

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Health check
    if (url === '/health' || url === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'browser-llm-bridge',
        port: BRIDGE_PORT,
        platforms: Object.keys(PLATFORMS),
        playwright: !!playwright,
      }));
      return;
    }

    // Models list
    if (url === '/v1/models' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: Object.keys(PLATFORMS).map(id => ({
          id,
          object: 'model',
          owned_by: 'browser-llm-bridge',
          created: 1700000000,
        })),
      }));
      return;
    }

    // Chat completions
    if (url === '/v1/chat/completions' && method === 'POST') {
      let body;
      try {
        const raw = await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', c => data += c);
          req.on('end', () => resolve(data));
          req.on('error', reject);
        });
        body = JSON.parse(raw);
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }));
        return;
      }

      const model = body.model || 'web/claude';
      const stream = !!body.stream;
      const userMessage = extractMessages(body);

      if (!PLATFORMS[model]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: `Unknown model '${model}'. Available: ${Object.keys(PLATFORMS).join(', ')}`,
            type: 'invalid_request_error',
          },
        }));
        return;
      }

      if (!userMessage) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'No user message found', type: 'invalid_request_error' } }));
        return;
      }

      try {
        console.log(LOG, `📨 ${model} request (${userMessage.length} chars, stream=${stream})`);
        const content = await sendMessage(model, userMessage);

        if (stream) {
          const id = `chatcmpl-${randomUUID().replace(/-/g, '').slice(0, 24)}`;
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          // Stream in chunks (simulate streaming)
          const words = content.split(' ');
          const chunkSize = 5;
          for (let i = 0; i < words.length; i += chunkSize) {
            const chunk = words.slice(i, i + chunkSize).join(' ') + (i + chunkSize < words.length ? ' ' : '');
            res.write(buildStreamChunk(id, model, chunk));
            await new Promise(r => setTimeout(r, 20));
          }
          res.write(buildStreamChunk(id, model, '', 'stop'));
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(buildCompletion(model, content)));
        }
      } catch (err) {
        console.error(LOG, `❌ Error from ${model}:`, err.message);
        const code = err.message.includes('expired') ? 503 : 500;
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: err.message,
            type: code === 503 ? 'session_expired' : 'internal_error',
          },
        }));
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `Not found: ${url}`, type: 'not_found' } }));
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(LOG, `⚠ Port ${BRIDGE_PORT} already in use — bridge may already be running`);
    } else {
      console.error(LOG, '❌ Server error:', err.message);
    }
  });

  server.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(LOG, `🚀 Browser LLM Bridge listening on http://127.0.0.1:${BRIDGE_PORT}`);
    console.log(LOG, `   Models: ${Object.keys(PLATFORMS).join(', ')}`);
    console.log(LOG, `   Health: http://127.0.0.1:${BRIDGE_PORT}/health`);
  });

  return server;
}

// ── Register HTTP middleware with patch-hooks ────────────────────────────────
// (No-op: bridge runs on its own port, not intercept OmniRoute's port)
if (global.__patchHooks) {
  global.__patchHooks.registerHttpMiddleware('browser-llm-bridge-info', (req, res, next) => {
    if (req.url === '/api/browser-llm-bridge/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'active',
        bridgePort: BRIDGE_PORT,
        platforms: Object.keys(PLATFORMS),
        playwrightAvailable: !!playwright,
      }));
      return;
    }
    next();
  }, { priority: 50 });
}

// ── Start ────────────────────────────────────────────────────────────────────
startBridgeServer();

console.log(LOG, '✨ Browser LLM Bridge patch loaded');
