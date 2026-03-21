/**
 * OpenClaw OmniRoute Modular Patch: Response Caching (Fetch-Based)
 * ================================================================
 * Caches AI responses at the fetch layer to reduce API calls and improve latency.
 * 
 * Features:
 * - TTL-based cache expiration
 * - Configurable cache size
 * - Cache hit/miss logging
 * - Auto-cleanup of expired entries
 * - Works with npm install AND git clone/self-build
 * - Compatible with Next.js streaming responses
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const CACHE_CONFIG = {
  enabled: true,
  ttl: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000, // Maximum cache entries
  cleanupInterval: 60 * 1000, // Cleanup every minute
  cacheablePaths: ['/v1/chat/completions', '/v1/completions'],
};

// ─── Cache Implementation ────────────────────────────────────────────────────

class ResponseCache {
  constructor(config = {}) {
    this.config = { ...CACHE_CONFIG, ...config };
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    
    // Start cleanup interval
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, this.config.cleanupInterval);
    }
  }
  
  /**
   * Generate cache key from request
   */
  generateKey(url, body) {
    try {
      const content = JSON.stringify({
        url,
        model: body?.model,
        messages: body?.messages?.map(m => ({ role: m.role, content: m.content })),
        temperature: body?.temperature || 0.7,
        max_tokens: body?.max_tokens
      });
      
      // Simple hash function
      let hash = 0;
      for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      
      return `cache_${Math.abs(hash).toString(36)}`;
    } catch (e) {
      return null;
    }
  }
  
  /**
   * Get cached response
   */
  get(key) {
    if (!this.config.enabled || !key) return null;
    
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    
    this.hits++;
    console.log(`[response-cache] ✅ Cache HIT (${this.hits}/${this.hits + this.misses})`);
    return entry.data;
  }
  
  /**
   * Set cached response
   */
  set(key, data) {
    if (!this.config.enabled || !key) return;
    
    // Check size limit
    if (this.cache.size >= this.config.maxSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.config.ttl,
      createdAt: Date.now()
    });
    
    console.log(`[response-cache] 💾 Cached response (${this.cache.size} entries)`);
  }
  
  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[response-cache] 🧹 Cleaned ${cleaned} expired entries`);
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 
        ? (this.hits / (this.hits + this.misses) * 100).toFixed(2) + '%'
        : '0%'
    };
  }
  
  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    console.log('[response-cache] 🗑️ Cache cleared');
  }
  
  /**
   * Destroy cache
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

// Create global cache instance
const responseCache = new ResponseCache();

/**
 * Patch fetch to add caching at the API call layer
 * This avoids conflicts with Next.js streaming responses
 */
function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      // Check if this is a cacheable request
      const urlString = typeof url === 'string' ? url : url?.url || '';
      const isCacheable = CACHE_CONFIG.cacheablePaths.some(path => 
        urlString.includes(path)
      );
      
      if (isCacheable && options.method === 'POST' && options.body) {
        try {
          // Parse request body
          let body;
          if (typeof options.body === 'string') {
            body = JSON.parse(options.body);
          } else {
            body = options.body;
          }
          
          // Generate cache key
          const cacheKey = responseCache.generateKey(urlString, body);
          
          // Check cache
          const cachedResponse = responseCache.get(cacheKey);
          if (cachedResponse) {
            // Return cached response as a Response object
            return new Response(JSON.stringify(cachedResponse), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Cache': 'HIT',
                'X-Cache-Key': cacheKey
              }
            });
          }
          
          // Make actual request
          const response = await originalFetch.call(this, url, options);
          
          // Cache successful responses
          if (response.ok) {
            try {
              // Clone response to read body without consuming it
              const clonedResponse = response.clone();
              const data = await clonedResponse.json();
              
              if (data.choices && data.choices.length > 0) {
                responseCache.set(cacheKey, data);
              }
            } catch (e) {
              // Not JSON or error, don't cache
            }
          }
          
          return response;
          
        } catch (e) {
          // Error in caching logic, fall back to original fetch
          return originalFetch.call(this, url, options);
        }
      }
      
      // Non-cacheable request, use original fetch
      return originalFetch.call(this, url, options);
    };
    
    console.log('[response-cache] ✅ Fetch patched for response caching');
    
    // Export cache for external access
    global.responseCache = responseCache;
    
  } catch (e) {
    console.error('[response-cache] ✖ Failed to patch fetch:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchFetch();
  console.log('[response-cache] 🚀 Response caching active');
  console.log(`[response-cache] 📊 Config: TTL=${CACHE_CONFIG.ttl/1000}s, MaxSize=${CACHE_CONFIG.maxSize}`);
  console.log('[response-cache] 📊 Cacheable paths:', CACHE_CONFIG.cacheablePaths.join(', '));
}

// Apply patch when module is loaded
applyPatch();
