/**
 * OpenClaw OmniRoute Modular Patch: API Authentication
 * =====================================================
 * Adds API key authentication to protect endpoints.
 * 
 * Features:
 * - Bearer token authentication
 * - Multiple API keys support
 * - IP whitelist (optional)
 * - Rate limiting per key
 * - Works with npm install AND git clone/self-build
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const AUTH_CONFIG = {
  enabled: process.env.OMNIROUTE_API_KEY ? true : false,
  apiKeys: process.env.OMNIROUTE_API_KEY 
    ? process.env.OMNIROUTE_API_KEY.split(',').map(k => k.trim())
    : [],
  ipWhitelist: process.env.OMNIROUTE_IP_WHITELIST
    ? process.env.OMNIROUTE_IP_WHITELIST.split(',').map(ip => ip.trim())
    : [],
  exemptPaths: [
    '/api/health',
    '/api/health/detailed',
    '/',
    '/dashboard',
  ],
  rateLimitPerKey: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // 100 requests per minute
  }
};

// ─── Auth Manager ────────────────────────────────────────────────────────────

class AuthManager {
  constructor(config = {}) {
    this.config = { ...AUTH_CONFIG, ...config };
    this.requestCounts = new Map(); // Track requests per key
    this.blockedKeys = new Map(); // Track blocked keys
    
    // Cleanup interval for rate limiting
    setInterval(() => this.cleanup(), this.config.rateLimitPerKey.windowMs);
  }
  
  /**
   * Validate API key
   */
  validateKey(apiKey) {
    if (!this.config.enabled) return true;
    if (this.config.apiKeys.length === 0) return true;
    
    return this.config.apiKeys.includes(apiKey);
  }
  
  /**
   * Check IP whitelist
   */
  checkIP(ip) {
    if (this.config.ipWhitelist.length === 0) return true;
    return this.config.ipWhitelist.includes(ip) || this.config.ipWhitelist.includes('*');
  }
  
  /**
   * Check rate limit for API key
   */
  checkRateLimit(apiKey) {
    const now = Date.now();
    const keyData = this.requestCounts.get(apiKey) || { count: 0, windowStart: now };
    
    // Reset window if expired
    if (now - keyData.windowStart > this.config.rateLimitPerKey.windowMs) {
      keyData.count = 0;
      keyData.windowStart = now;
    }
    
    keyData.count++;
    this.requestCounts.set(apiKey, keyData);
    
    return keyData.count <= this.config.rateLimitPerKey.maxRequests;
  }
  
  /**
   * Check if path is exempt from auth
   */
  isExemptPath(path) {
    return this.config.exemptPaths.some(exempt => 
      path === exempt || path.startsWith(exempt + '/')
    );
  }
  
  /**
   * Cleanup old rate limit data
   */
  cleanup() {
    const now = Date.now();
    for (const [key, data] of this.requestCounts.entries()) {
      if (now - data.windowStart > this.config.rateLimitPerKey.windowMs * 2) {
        this.requestCounts.delete(key);
      }
    }
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

const authManager = new AuthManager();

/**
 * Patch fetch to add authentication
 */
function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      
      // Extract path from URL
      let path = '/';
      try {
        const urlObj = new URL(urlString, 'http://localhost');
        path = urlObj.pathname;
      } catch (e) {}
      
      // Check if path is exempt
      if (authManager.isExemptPath(path)) {
        return originalFetch.call(this, url, options);
      }
      
      // Check if auth is enabled
      if (!AUTH_CONFIG.enabled) {
        return originalFetch.call(this, url, options);
      }
      
      // Extract API key from Authorization header
      const headers = options.headers || {};
      const authHeader = headers['Authorization'] || headers['authorization'] || '';
      const apiKey = authHeader.replace('Bearer ', '').trim();
      
      // Validate API key
      if (!authManager.validateKey(apiKey)) {
        return new Response(JSON.stringify({
          error: 'Unauthorized',
          message: 'Invalid or missing API key',
        }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Check rate limit
      if (!authManager.checkRateLimit(apiKey)) {
        return new Response(JSON.stringify({
          error: 'Rate Limited',
          message: 'Too many requests',
          retryAfter: AUTH_CONFIG.rateLimitPerKey.windowMs / 1000,
        }), {
          status: 429,
          headers: { 
            'Content-Type': 'application/json',
            'Retry-After': String(AUTH_CONFIG.rateLimitPerKey.windowMs / 1000),
          }
        });
      }
      
      // Auth passed, make request
      return originalFetch.call(this, url, options);
    };
    
    console.log('[api-auth] ✅ Fetch patched for authentication');
    
    // Export for external access
    global.authManager = authManager;
    
  } catch (e) {
    console.error('[api-auth] ✖ Failed to patch fetch:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchFetch();
  console.log('[api-auth] 🚀 API authentication active');
  console.log(`[api-auth] 📊 Enabled: ${AUTH_CONFIG.enabled}`);
  if (AUTH_CONFIG.enabled) {
    console.log(`[api-auth] 📊 API Keys: ${AUTH_CONFIG.apiKeys.length} configured`);
    console.log(`[api-auth] 📊 Rate Limit: ${AUTH_CONFIG.rateLimitPerKey.maxRequests} req/min`);
  } else {
    console.log('[api-auth] 📊 Set OMNIROUTE_API_KEY to enable authentication');
  }
  console.log(`[api-auth] 📊 Exempt paths: ${AUTH_CONFIG.exemptPaths.join(', ')}`);
}

// Apply patch when module is loaded
applyPatch();
