/**
 * OpenClaw OmniRoute Modular Patch: Response Caching (Fetch-Based)
 * FIXED: Skip streaming/SSE responses to prevent hang
 */

'use strict';

const CACHE_CONFIG = {
  enabled: true,
  ttl: 5 * 60 * 1000,
  maxSize: 1000,
  cleanupInterval: 60 * 1000,
  cacheablePaths: ['/v1/chat/completions', '/v1/completions'],
};

class ResponseCache {
  constructor(config = {}) {
    this.config = { ...CACHE_CONFIG, ...config };
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(() => this.cleanup(), this.config.cleanupInterval);
    }
  }

  generateKey(url, body) {
    try {
      // Don't cache streaming requests
      if (body?.stream === true) return null;
      const content = JSON.stringify({
        url,
        model: body?.model,
        messages: body?.messages?.map(m => ({ role: m.role, content: m.content })),
        temperature: body?.temperature || 0.7,
        max_tokens: body?.max_tokens
      });
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return `cache_${Math.abs(hash).toString(36)}`;
    } catch (e) {
      return null;
    }
  }

  get(key) {
    if (!this.config.enabled || !key) return null;
    const entry = this.cache.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() > entry.expiresAt) { this.cache.delete(key); this.misses++; return null; }
    this.hits++;
    console.log(`[response-cache] ✅ Cache HIT (${this.hits}/${this.hits + this.misses})`);
    return entry.data;
  }

  set(key, data) {
    if (!this.config.enabled || !key) return;
    if (this.cache.size >= this.config.maxSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { data, expiresAt: Date.now() + this.config.ttl, createdAt: Date.now() });
    console.log(`[response-cache] 💾 Cached response (${this.cache.size} entries)`);
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) { this.cache.delete(key); cleaned++; }
    }
    if (cleaned > 0) console.log(`[response-cache] 🧹 Cleaned ${cleaned} expired entries`);
  }
}

const responseCache = new ResponseCache();

function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      const isCacheable = CACHE_CONFIG.cacheablePaths.some(path => urlString.includes(path));

      if (isCacheable && options.method === 'POST' && options.body) {
        try {
          let body;
          try {
            body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          } catch (e) {
            return originalFetch.call(this, url, options);
          }

          // CRITICAL FIX: Never cache streaming requests
          if (body?.stream === true) {
            return originalFetch.call(this, url, options);
          }

          const cacheKey = responseCache.generateKey(urlString, body);

          const cachedResponse = responseCache.get(cacheKey);
          if (cachedResponse) {
            return new Response(JSON.stringify(cachedResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
            });
          }

          const response = await originalFetch.call(this, url, options);

          // CRITICAL FIX: Only cache non-streaming JSON responses
          if (response.ok) {
            const contentType = response.headers.get('content-type') || '';
            const isStreaming = contentType.includes('text/event-stream') ||
                                contentType.includes('text/stream');
            if (!isStreaming) {
              try {
                const clonedResponse = response.clone();
                const data = await clonedResponse.json();
                if (data && data.choices && data.choices.length > 0) {
                  responseCache.set(cacheKey, data);
                }
              } catch (e) {
                // Not JSON or streaming, skip
              }
            }
          }

          return response;
        } catch (e) {
          return originalFetch.call(this, url, options);
        }
      }

      return originalFetch.call(this, url, options);
    };

    console.log('[response-cache] ✅ Fetch patched for response caching (streaming-safe)');
    global.responseCache = responseCache;
  } catch (e) {
    console.error('[response-cache] ✖ Failed to patch fetch:', e.message);
  }
}

function applyPatch() {
  patchFetch();
  console.log('[response-cache] 🚀 Response caching active (streaming-safe)');
}

applyPatch();
