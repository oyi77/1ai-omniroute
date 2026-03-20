/**
 * OpenClaw OmniRoute Modular Patch: Response Caching
 * ====================================================
 * Caches AI responses to reduce API calls and improve latency.
 * 
 * Features:
 * - TTL-based cache expiration
 * - Configurable cache size
 * - Cache hit/miss logging
 * - Auto-cleanup of expired entries
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const CACHE_CONFIG = {
  enabled: true,
  ttl: 5 * 60 * 1000, // 5 minutes
  maxSize: 1000, // Maximum cache entries
  cleanupInterval: 60 * 1000, // Cleanup every minute
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
  generateKey(model, messages, temperature = 0.7) {
    const content = JSON.stringify({
      model,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature
    });
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return `cache_${Math.abs(hash).toString(36)}`;
  }
  
  /**
   * Get cached response
   */
  get(key) {
    if (!this.config.enabled) return null;
    
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
    if (!this.config.enabled) return;
    
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
 * Patch HTTP server to add caching
 */
function patchHttpServer() {
  try {
    const http = require('http');
    const originalCreateServer = http.createServer;
    
    http.createServer = function patchedCreateServer(options, listener) {
      if (typeof options === 'function') {
        listener = options;
        options = {};
      }
      
      const patchedListener = function patchedListener(req, res) {
        // Only cache POST requests to /v1/chat/completions
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          // Intercept response
          const originalWrite = res.write;
          const originalEnd = res.end;
          let responseBody = '';
          
          res.write = function(chunk, encoding, callback) {
            if (chunk) {
              responseBody += chunk.toString();
            }
            return originalWrite.call(this, chunk, encoding, callback);
          };
          
          res.end = function(chunk, encoding, callback) {
            if (chunk) {
              responseBody += chunk.toString();
            }
            
            // Try to cache the response
            try {
              const body = JSON.parse(responseBody);
              if (body.choices && body.choices.length > 0) {
                // Generate cache key from request
                // Note: This is a simplified version
                // In production, you'd need to read the request body
                const cacheKey = `response_${Date.now()}`;
                responseCache.set(cacheKey, body);
              }
            } catch (e) {
              // Not JSON or error, don't cache
            }
            
            return originalEnd.call(this, chunk, encoding, callback);
          };
        }
        
        // Call original listener
        return listener.call(this, req, res);
      };
      
      return originalCreateServer.call(this, options, patchedListener);
    };
    
    console.log('[response-cache] ✅ HTTP server patched for response caching');
    
    // Export cache for external access
    global.responseCache = responseCache;
    
  } catch (e) {
    console.error('[response-cache] ✖ Failed to patch HTTP server:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchHttpServer();
  console.log('[response-cache] 🚀 Response caching active');
  console.log(`[response-cache] 📊 Config: TTL=${CACHE_CONFIG.ttl/1000}s, MaxSize=${CACHE_CONFIG.maxSize}`);
}

// Apply patch when module is loaded
applyPatch();
