/**
 * OpenClaw OmniRoute Patch: Anthropic Prompt Caching
 * ===================================================
 * Auto-injects cache_control into outgoing requests to Anthropic/Claude.
 * Patches Node.js http.request (more reliable than globalThis.fetch for Next.js).
 *
 * Saves up to 90% on cached input tokens.
 * STREAMING-SAFE: Only modifies request body, not response.
 */

'use strict';

const CLAUDE_MODEL_PATTERNS = ['claude-'];
const ANTHROPIC_PATHS = ['/v1/messages', '/v1/chat/completions'];

let stats = { injected: 0, skipped: 0 };

function isClaudeModel(model) {
  if (!model) return false;
  const m = String(model).toLowerCase();
  return CLAUDE_MODEL_PATTERNS.some(p => m.includes(p));
}

function isAnthropicHost(hostname) {
  if (!hostname) return false;
  // Only direct Anthropic API endpoints support cache_control.
  // Antigravity routes Claude via Google Vertex AI which uses a different format
  // and rejects unknown fields like cache_control with HTTP 400.
  return hostname.includes('anthropic.com') ||
         hostname.includes('claude.ai');
}

function isAnthropicPath(path) {
  return ANTHROPIC_PATHS.some(p => path && path.includes(p));
}

function patchHttpRequest() {
  try {
    const http = require('http');
    const https = require('https');

    function makePatched(originalRequest, protocol) {
      return function patchedRequest(options, callback) {
        // Only patch HTTPS outgoing requests (Anthropic API is HTTPS)
        if (protocol !== 'https') {
          return originalRequest.call(this, options, callback);
        }

        const hostname = (typeof options === 'string' ? new URL(options).hostname : options?.hostname) || '';
        const path = (typeof options === 'string' ? new URL(options).pathname : options?.path) || '';

        if (!isAnthropicHost(hostname) && !isAnthropicPath(path)) {
          return originalRequest.call(this, options, callback);
        }

        // Get the request object
        const req = originalRequest.call(this, options, callback);

        // Intercept write to inject cache_control into body
        const originalWrite = req.write.bind(req);
        const originalEnd = req.end.bind(req);
        let chunks = [];
        let intercepted = false;

        req.write = function(chunk, encoding, cb) {
          if (!intercepted) {
            chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
            return req; // buffer, don't send yet
          }
          return originalWrite(chunk, encoding, cb);
        };

        req.end = function(chunk, encoding, cb) {
          if (!intercepted) {
            intercepted = true;
            if (chunk) chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());

            let bodyStr = chunks.join('');
            try {
              const body = JSON.parse(bodyStr);

              if (isClaudeModel(body.model) && !body.cache_control) {
                body.cache_control = { type: 'ephemeral' };
                bodyStr = JSON.stringify(body);
                stats.injected++;
                // Update Content-Length header if possible
                try {
                  const newLen = Buffer.byteLength(bodyStr);
                  if (req.setHeader) req.setHeader('Content-Length', newLen);
                } catch(e) {}
              } else {
                stats.skipped++;
              }
            } catch(e) {
              // Not JSON, pass through unchanged
            }

            return originalEnd(bodyStr, encoding, cb);
          }
          return originalEnd(chunk, encoding, cb);
        };

        return req;
      };
    }

    // Patch both http and https
    https.request = makePatched(https.request, 'https');

    // Also patch globalThis.fetch as backup
    if (globalThis.fetch) {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async function(url, options = {}) {
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (isAnthropicHost(urlStr) || ANTHROPIC_PATHS.some(p => urlStr.includes(p))) {
          if (options.method === 'POST' && options.body) {
            try {
              let body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
              if (isClaudeModel(body?.model) && !body?.cache_control) {
                body = { ...body, cache_control: { type: 'ephemeral' } };
                options = { ...options, body: JSON.stringify(body) };
                stats.injected++;
              }
            } catch(e) {}
          }
        }
        return origFetch.call(this, url, options);
      };
    }

    console.log('[prompt-cache-anthropic] ✅ Anthropic prompt cache injection active (http.request + fetch)');
    global.promptCacheStats = stats;

    setInterval(() => {
      if (stats.injected > 0 || stats.skipped > 0) {
        console.log(`[prompt-cache-anthropic] 📊 Stats: injected=${stats.injected} skipped=${stats.skipped}`);
      }
    }, 5 * 60 * 1000);

  } catch(e) {
    console.error('[prompt-cache-anthropic] ✖ Patch failed:', e.message);
  }
}

function applyPatch() {
  patchHttpRequest();
  console.log('[prompt-cache-anthropic] 🚀 Anthropic prompt caching enabled (http.request level)');
  console.log('[prompt-cache-anthropic] 💰 Expected savings: up to 90% on cached input tokens');
}

applyPatch();
