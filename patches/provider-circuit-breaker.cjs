/**
 * OpenClaw OmniRoute Modular Patch: Provider Circuit Breaker
 * ============================================================
 * Implements circuit breaker pattern for AI providers with:
 * - Three states: CLOSED, OPEN, HALF-OPEN
 * - Exponential backoff with jitter
 * - Auto-recovery testing
 * - Health monitoring
 * 
 * Based on research of free AI API providers (2026)
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const CIRCUIT_BREAKER_CONFIG = {
  enabled: true,

  // Circuit breaker settings
  failureThreshold: 5,        // Failures before opening circuit
  successThreshold: 2,        // Successes to close circuit from half-open
  resetTimeout: 30000,        // 30 seconds before testing recovery
  halfOpenMaxRequests: 3,     // Max requests in half-open state

  // Retry settings
  maxRetries: 3,
  baseDelay: 1000,            // 1 second base delay
  maxDelay: 10000,            // 10 seconds max delay
  jitter: true,               // Add randomness to prevent thundering herd

  // Health check settings
  healthCheckInterval: 60000, // 1 minute
  healthCheckTimeout: 5000,   // 5 seconds

  // Free providers to monitor
  freeProviders: [
    'antigravity',
    'openai-compatible-chat-12a6e8a3-41c9-44e6-aeb0-e017bf86a76a', // G4F.dev
    'openai-compatible-chat-f47261d3-39f5-4c2d-9e1d-057fe346b013', // Pollinations
    'openai-compatible-chat-cb6defca-c00f-466a-894c-ec1f45a03e53', // uncloseai
  ],

  // Statistics retention
  statsRetention: 24 * 60 * 60 * 1000, // 24 hours
};

// ─── Circuit Breaker States ──────────────────────────────────────────────────

const CircuitState = {
  CLOSED: 'CLOSED',       // Normal operation
  OPEN: 'OPEN',           // Failing fast
  HALF_OPEN: 'HALF_OPEN'  // Testing recovery
};

// ─── Circuit Breaker Implementation ─────────────────────────────────────────

class CircuitBreaker {
  constructor(provider, config = {}) {
    this.provider = provider;
    this.config = { ...CIRCUIT_BREAKER_CONFIG, ...config };
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.lastFailureTime = null;
    this.halfOpenRequests = 0;
    this.nextAttempt = 0;

    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      circuitOpens: 0,
      circuitCloses: 0,
      avgResponseTime: 0,
      lastRequest: null,
      lastSuccess: null,
      lastFailure: null,
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn) {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttempt) {
        // Circuit is open and not ready for recovery test
        throw new Error(`Circuit OPEN for ${this.provider}. Next attempt in ${Math.ceil((this.nextAttempt - Date.now()) / 1000)}s`);
      }

      // Transition to half-open
      this.state = CircuitState.HALF_OPEN;
      this.halfOpenRequests = 0;
      console.log(`[circuit-breaker] ${this.provider}: OPEN → HALF_OPEN (testing recovery)`);
    }

    // Check half-open request limit
    if (this.state === CircuitState.HALF_OPEN && this.halfOpenRequests >= this.config.halfOpenMaxRequests) {
      throw new Error(`Circuit HALF_OPEN for ${this.provider}. Max test requests reached.`);
    }

    // Execute with retry logic
    const startTime = Date.now();

    try {
      const result = await this.executeWithRetry(fn);
      const duration = Date.now() - startTime;

      // Record success
      this.recordSuccess(duration);

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Record failure
      this.recordFailure(duration, error);

      throw error;
    }
  }

  /**
   * Execute with exponential backoff retry
   */
  async executeWithRetry(fn) {
    let lastError;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        // Don't retry on last attempt
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff
        let delay = Math.min(
          this.config.baseDelay * Math.pow(2, attempt),
          this.config.maxDelay
        );

        // Add jitter to prevent thundering herd
        if (this.config.jitter) {
          delay = delay * (0.5 + Math.random() * 0.5);
        }

        console.log(`[circuit-breaker] ${this.provider}: Retry ${attempt + 1}/${this.config.maxRetries} in ${Math.round(delay)}ms`);

        // Wait before retry
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Record successful request
   */
  recordSuccess(duration) {
    this.stats.totalRequests++;
    this.stats.successfulRequests++;
    this.stats.lastRequest = Date.now();
    this.stats.lastSuccess = Date.now();
    this.stats.avgResponseTime = (this.stats.avgResponseTime * (this.stats.totalRequests - 1) + duration) / this.stats.totalRequests;

    // Update circuit state
    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      this.halfOpenRequests++;

      if (this.successes >= this.config.successThreshold) {
        // Close the circuit
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successes = 0;
        this.stats.circuitCloses++;
        console.log(`[circuit-breaker] ${this.provider}: HALF_OPEN → CLOSED (recovered)`);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failures on success
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  /**
   * Record failed request
   */
  recordFailure(duration, error) {
    this.stats.totalRequests++;
    this.stats.failedRequests++;
    this.stats.lastRequest = Date.now();
    this.stats.lastFailure = Date.now();
    this.stats.avgResponseTime = (this.stats.avgResponseTime * (this.stats.totalRequests - 1) + duration) / this.stats.totalRequests;

    // Update circuit state
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Failure in half-open state opens the circuit immediately
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.resetTimeout;
      this.stats.circuitOpens++;
      console.log(`[circuit-breaker] ${this.provider}: HALF_OPEN → OPEN (recovery failed)`);
    } else if (this.state === CircuitState.CLOSED && this.failures >= this.config.failureThreshold) {
      // Open the circuit
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.config.resetTimeout;
      this.stats.circuitOpens++;
      console.log(`[circuit-breaker] ${this.provider}: CLOSED → OPEN (${this.failures} failures)`);
    }
  }

  /**
   * Get circuit status
   */
  getStatus() {
    return {
      provider: this.provider,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      nextAttempt: this.state === CircuitState.OPEN ? new Date(this.nextAttempt).toISOString() : null,
      stats: {
        ...this.stats,
        successRate: this.stats.totalRequests > 0
          ? (this.stats.successfulRequests / this.stats.totalRequests * 100).toFixed(2) + '%'
          : '0%',
        avgResponseTimeMs: Math.round(this.stats.avgResponseTime) + 'ms',
      },
      config: {
        failureThreshold: this.config.failureThreshold,
        successThreshold: this.config.successThreshold,
        resetTimeout: this.config.resetTimeout,
      }
    };
  }

  /**
   * Reset circuit breaker
   */
  reset() {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;
    this.halfOpenRequests = 0;
    this.nextAttempt = 0;
    console.log(`[circuit-breaker] ${this.provider}: Reset to CLOSED`);
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ─── Provider Circuit Breaker Manager ───────────────────────────────────────

class ProviderCircuitBreakerManager {
  constructor(config = {}) {
    this.config = { ...CIRCUIT_BREAKER_CONFIG, ...config };
    this.breakers = new Map();
    this.healthCheckInterval = null;

    // Initialize circuit breakers for all free providers
    if (this.config.enabled) {
      this.initializeBreakers();
      this.startHealthChecks();
    }
  }

  /**
   * Initialize circuit breakers for all configured providers
   */
  initializeBreakers() {
    for (const provider of this.config.freeProviders) {
      this.breakers.set(provider, new CircuitBreaker(provider, this.config));
    }

    console.log(`[circuit-breaker] ✅ Initialized ${this.breakers.size} circuit breakers`);
  }

  /**
   * Start health check interval
   */
  startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);

    console.log(`[circuit-breaker] ✅ Health checks started (interval: ${this.config.healthCheckInterval / 1000}s)`);
  }

  /**
   * Perform health checks on all providers
   */
  async performHealthChecks() {
    console.log(`[circuit-breaker] 🏥 Performing health checks...`);

    for (const [provider, breaker] of this.breakers.entries()) {
      try {
        // Simple health check - try to make a minimal request
        // In production, this would be a dedicated health endpoint
        await this.checkProviderHealth(provider);

        // If health check succeeds and circuit is open, move to half-open
        if (breaker.state === CircuitState.OPEN) {
          breaker.state = CircuitState.HALF_OPEN;
          breaker.halfOpenRequests = 0;
          console.log(`[circuit-breaker] ${provider}: Health check passed, moving to HALF_OPEN`);
        }
      } catch (error) {
        console.log(`[circuit-breaker] ${provider}: Health check failed - ${error.message}`);
      }
    }
  }

  /**
   * Check provider health via real HTTP ping to OmniRoute models endpoint
   */
  async checkProviderHealth(provider) {
    return new Promise((resolve, reject) => {
      try {
        const http = require('http');
        const req = http.request({
          hostname: '127.0.0.1',
          port: 20128,
          path: '/v1/models',
          method: 'GET',
          timeout: this.config.healthCheckTimeout,
        }, (res) => {
          let data = '';
          res.on('data', chunk => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode < 400) resolve();
            else reject(new Error(`HTTP ${res.statusCode}`));
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Get or create circuit breaker for provider
   */
  getBreaker(provider) {
    if (!this.breakers.has(provider)) {
      this.breakers.set(provider, new CircuitBreaker(provider, this.config));
    }

    return this.breakers.get(provider);
  }

  /**
   * Execute request through circuit breaker
   */
  async execute(provider, fn) {
    const breaker = this.getBreaker(provider);
    return breaker.execute(fn);
  }

  /**
   * Get status of all circuit breakers
   */
  getStatus() {
    const status = {};

    for (const [provider, breaker] of this.breakers.entries()) {
      status[provider] = breaker.getStatus();
    }

    return {
      enabled: this.config.enabled,
      totalBreakers: this.breakers.size,
      breakers: status,
      summary: this.getSummary(),
    };
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    let totalRequests = 0;
    let totalSuccess = 0;
    let totalFailures = 0;
    let openCircuits = 0;
    let halfOpenCircuits = 0;

    for (const breaker of this.breakers.values()) {
      totalRequests += breaker.stats.totalRequests;
      totalSuccess += breaker.stats.successfulRequests;
      totalFailures += breaker.stats.failedRequests;

      if (breaker.state === CircuitState.OPEN) openCircuits++;
      if (breaker.state === CircuitState.HALF_OPEN) halfOpenCircuits++;
    }

    return {
      totalRequests,
      successRate: totalRequests > 0 ? (totalSuccess / totalRequests * 100).toFixed(2) + '%' : '0%',
      openCircuits,
      halfOpenCircuits,
      healthyCircuits: this.breakers.size - openCircuits - halfOpenCircuits,
    };
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
    console.log('[circuit-breaker] 🔄 All circuit breakers reset');
  }

  /**
   * Reset specific provider
   */
  resetProvider(provider) {
    const breaker = this.breakers.get(provider);
    if (breaker) {
      breaker.reset();
      console.log(`[circuit-breaker] 🔄 Reset circuit breaker for ${provider}`);
    }
  }

  /**
   * Destroy manager
   */
  destroy() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    this.breakers.clear();
    console.log('[circuit-breaker] 🗑️ Manager destroyed');
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

// Create global circuit breaker manager
const circuitBreakerManager = new ProviderCircuitBreakerManager();

/**
 * Circuit breaker HTTP middleware.
 * Adds /api/circuit-breaker/* endpoints, and tracks API request success/failure
 * via res.end hook (no res.write buffering — streaming-safe).
 */
function circuitBreakerMiddleware(req, res, next) {
  // Status endpoint
  if (req.url === '/api/circuit-breaker/status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(circuitBreakerManager.getStatus(), null, 2));
    return;
  }

  // Reset endpoint
  if (req.url === '/api/circuit-breaker/reset' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.provider) {
          circuitBreakerManager.resetProvider(data.provider);
        } else {
          circuitBreakerManager.resetAll();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Circuit breaker reset' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // Track API requests — hook only res.end for status code (streaming-safe, no body buffering)
  if (req.url && req.url.startsWith('/v1/') && req.method === 'POST') {
    const startTime = Date.now();
    const originalEnd = res.end;

    res.end = function (chunk, encoding, callback) {
      const duration = Date.now() - startTime;
      const success = res.statusCode < 400;

      // Try to extract provider from the last chunk if it's JSON
      let provider = 'unknown';
      if (chunk) {
        try {
          const str = typeof chunk === 'string' ? chunk : chunk.toString();
          const response = JSON.parse(str);
          if (response.model) {
            provider = response.model.split('/')[0];
          }
        } catch (e) {
          // Can't parse, that's fine — might be streaming
        }
      }

      if (provider !== 'unknown') {
        const breaker = circuitBreakerManager.getBreaker(provider);
        if (success) {
          breaker.recordSuccess(duration);
        } else {
          breaker.recordFailure(duration, `HTTP ${res.statusCode}`);
        }
      }

      return originalEnd.call(this, chunk, encoding, callback);
    };
  }

  next();
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  if (global.__patchHooks) {
    // Priority 80 — run after most middleware but before diagnostics
    global.__patchHooks.registerHttpMiddleware('circuit-breaker', circuitBreakerMiddleware, { priority: 80 });
  } else {
    console.error('[circuit-breaker] ✖ patch-hooks not loaded — circuit-breaker will not work');
  }

  // Export manager for external access
  global.circuitBreakerManager = circuitBreakerManager;

  console.log('[circuit-breaker] 🚀 Circuit breaker pattern active');
  console.log(`[circuit-breaker] 📊 Monitoring ${CIRCUIT_BREAKER_CONFIG.freeProviders.length} free providers`);
  console.log(`[circuit-breaker] 📊 Config: Threshold=${CIRCUIT_BREAKER_CONFIG.failureThreshold} failures, Reset=${CIRCUIT_BREAKER_CONFIG.resetTimeout / 1000}s`);
  console.log('[circuit-breaker] 📊 Endpoints:');
  console.log('  - GET /api/circuit-breaker/status');
  console.log('  - POST /api/circuit-breaker/reset');
}

// Apply patch when module is loaded
applyPatch();
