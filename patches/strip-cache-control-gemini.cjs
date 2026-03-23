/**
 * OmniRoute Patch: Strip cache_control for Gemini/Antigravity
 * ============================================================
 * Google's Gemini API rejects requests containing Anthropic's
 * `cache_control` field. OmniRoute's translator should strip it
 * but sometimes leaks it through (especially in system messages
 * and tools array).
 *
 * This patch monkey-patches the global fetch to intercept requests
 * to Google Gemini endpoints and strip `cache_control` from the
 * JSON payload before sending.
 *
 * Fixes: HTTP 400 "Invalid JSON payload received. Unknown name
 *        "cache_control": Cannot find field."
 */

'use strict';

var GOOGLE_ENDPOINTS = [
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  'cloudcode-pa.googleapis.com',
  'autopush-cloudcode-pa.sandbox.googleapis.com',
];

/**
 * Recursively strip `cache_control` from any object/array
 */
function stripCacheControl(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(stripCacheControl);
  }

  var result = {};
  for (var key in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (key === 'cache_control') continue; // Strip it
    result[key] = stripCacheControl(obj[key]);
  }
  return result;
}

/**
 * Check if a URL points to a Google Gemini endpoint
 */
function isGeminiEndpoint(url) {
  if (!url) return false;
  var urlStr = typeof url === 'string' ? url : url.toString();
  for (var i = 0; i < GOOGLE_ENDPOINTS.length; i++) {
    if (urlStr.indexOf(GOOGLE_ENDPOINTS[i]) !== -1) return true;
  }
  return false;
}

// ─── Monkey-patch fetch ──────────────────────────────────────────────────────

var originalFetch = globalThis.fetch;

if (originalFetch) {
  globalThis.fetch = function patchedFetch(url, options) {
    // Only intercept POST requests to Gemini endpoints
    if (options && options.method === 'POST' && isGeminiEndpoint(url)) {
      var body = options.body;
      if (typeof body === 'string' && body.indexOf('cache_control') !== -1) {
        try {
          var parsed = JSON.parse(body);
          var cleaned = stripCacheControl(parsed);
          options = Object.assign({}, options, { body: JSON.stringify(cleaned) });
        } catch (_) {
          // Not JSON or parse error — pass through
        }
      }
    }
    return originalFetch.apply(this, [url, options]);
  };

  console.log('[strip-cache-control-gemini] ✅ Fetch patched — cache_control will be stripped for Gemini endpoints');
} else {
  console.log('[strip-cache-control-gemini] ⚠ globalThis.fetch not available — will retry on next tick');

  // In case fetch isn't available at load time (Node.js)
  setImmediate(function () {
    var fetch = globalThis.fetch;
    if (!fetch) return;

    globalThis.fetch = function patchedFetch(url, options) {
      if (options && options.method === 'POST' && isGeminiEndpoint(url)) {
        var body = options.body;
        if (typeof body === 'string' && body.indexOf('cache_control') !== -1) {
          try {
            var parsed = JSON.parse(body);
            var cleaned = stripCacheControl(parsed);
            options = Object.assign({}, options, { body: JSON.stringify(cleaned) });
          } catch (_) {}
        }
      }
      return fetch.apply(this, [url, options]);
    };

    console.log('[strip-cache-control-gemini] ✅ Fetch patched (deferred) — cache_control will be stripped for Gemini endpoints');
  });
}
