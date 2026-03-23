/**
 * OpenClaw OmniRoute Patch: Max Tokens Guard
 * ==========================================
 * Prevents max_tokens from going negative when model context window
 * is smaller than DEFAULT_MAX_TOKENS (64000).
 *
 * Root cause: DEFAULT_MAX_TOKENS=64000 sent to models with context_window ~30592
 * Result: -33408 error from Anthropic API ("max_tokens must be at least 1")
 *
 * Fix: Cap max_tokens to a safe maximum (32000) and ensure >= 1 always.
 */

'use strict';

// Known model context window limits (max safe output tokens)
const MODEL_MAX_OUTPUT = {
  // Claude 3 family (smaller context)
  'claude-3-haiku': 4096,
  'claude-3-sonnet': 4096,
  'claude-3-opus': 4096,
  'claude-haiku-3': 4096,
  // Claude 3.5/4 family
  'claude-3-5-haiku': 8192,
  'claude-3-5-sonnet': 8192,
  'claude-haiku-4': 16000,
  'claude-sonnet-4': 16000,
  'claude-opus-4': 16000,
};

// Hard cap: never send more than this to ANY model
// 30592 is the smallest known context window that triggered -33408
const SAFE_MAX_TOKENS = 16000;
const ABSOLUTE_MIN = 1;

function getModelMaxOutput(model) {
  if (!model) return SAFE_MAX_TOKENS;
  const m = String(model).toLowerCase();
  for (const [key, limit] of Object.entries(MODEL_MAX_OUTPUT)) {
    if (m.includes(key)) return limit;
  }
  return SAFE_MAX_TOKENS;
}

function patchFetch() {
  if (!globalThis.fetch) return;
  const origFetch = globalThis.fetch;

  globalThis.fetch = async function(url, options = {}) {
    const urlStr = typeof url === 'string' ? url : (url?.url || String(url));
    const isAnthropicCall = urlStr.includes('anthropic.com') || urlStr.includes('/v1/messages');

    if (isAnthropicCall && options.method === 'POST' && options.body) {
      try {
        let body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
        if (body && typeof body === 'object' && body.max_tokens !== undefined) {
          const modelLimit = getModelMaxOutput(body.model);
          const original = body.max_tokens;

          // Cap to model limit, ensure >= 1
          const capped = Math.max(ABSOLUTE_MIN, Math.min(original, modelLimit));

          if (capped !== original) {
            console.log(`[max-tokens-guard] ⚠️  Capped max_tokens: ${original} → ${capped} (model=${body.model})`);
            body = { ...body, max_tokens: capped };
            options = { ...options, body: JSON.stringify(body) };
          }
        }
      } catch(e) {}
    }

    return origFetch.call(this, url, options);
  };
}

function patchHttps() {
  try {
    const https = require('https');
    const origRequest = https.request;

    https.request = function(options, callback) {
      const hostname = (typeof options === 'string' ? new URL(options).hostname : options?.hostname) || '';
      const path = (typeof options === 'string' ? new URL(options).pathname : options?.path) || '';
      const isAnthropic = hostname.includes('anthropic.com') || path.includes('/v1/messages');

      const req = origRequest.call(this, options, callback);

      if (!isAnthropic) return req;

      const origWrite = req.write.bind(req);
      const origEnd = req.end.bind(req);
      let chunks = [];
      let done = false;

      req.write = function(chunk, enc, cb) {
        if (!done) { chunks.push(typeof chunk === 'string' ? chunk : chunk.toString()); return req; }
        return origWrite(chunk, enc, cb);
      };

      req.end = function(chunk, enc, cb) {
        if (!done) {
          done = true;
          if (chunk) chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
          let bodyStr = chunks.join('');
          try {
            const body = JSON.parse(bodyStr);
            if (body && body.max_tokens !== undefined) {
              const modelLimit = getModelMaxOutput(body.model);
              const original = body.max_tokens;
              const capped = Math.max(ABSOLUTE_MIN, Math.min(original, modelLimit));
              if (capped !== original) {
                console.log(`[max-tokens-guard] ⚠️  Capped max_tokens: ${original} → ${capped} (model=${body.model})`);
                body.max_tokens = capped;
                bodyStr = JSON.stringify(body);
                try {
                  const newLen = Buffer.byteLength(bodyStr);
                  if (req.setHeader) req.setHeader('Content-Length', newLen);
                } catch(e) {}
              }
            }
          } catch(e) {}
          return origEnd(bodyStr, enc, cb);
        }
        return origEnd(chunk, enc, cb);
      };

      return req;
    };
  } catch(e) {
    console.error('[max-tokens-guard] https patch failed:', e.message);
  }
}

patchFetch();
patchHttps();
console.log('[max-tokens-guard] ✅ Active — prevents negative max_tokens to Anthropic API');
