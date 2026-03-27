/**
 * OpenClaw OmniRoute Modular Patch: Health Check Endpoint
 * ========================================================
 * Provides comprehensive health check endpoint for monitoring.
 * 
 * Features:
 * - System uptime tracking
 * - Provider health status
 * - Request success rate
 * - Memory usage
 * - Response time metrics
 * - Works with npm install AND git clone/self-build
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const HEALTH_CONFIG = {
  endpoint: '/api/health',
  detailedEndpoint: '/api/health/detailed',
  includeMemory: true,
  includeProviders: true,
};

// ─── Health Check Implementation ─────────────────────────────────────────────

class HealthMonitor {
  constructor() {
    this.startTime = Date.now();
    this.requestCount = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.totalLatency = 0;
    this.latencies = [];
    this.maxLatencies = 1000; // Keep last 1000 latencies
  }

  /**
   * Record a request
   */
  recordRequest(latency, success = true) {
    this.requestCount++;
    this.totalLatency += latency;

    if (success) {
      this.successCount++;
    } else {
      this.errorCount++;
    }

    // Store latency for percentile calculation
    this.latencies.push(latency);
    if (this.latencies.length > this.maxLatencies) {
      this.latencies.shift();
    }
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(percentile) {
    if (this.latencies.length === 0) return 0;

    const sorted = [...this.latencies].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get uptime string
   */
  getUptime() {
    const uptimeMs = Date.now() - this.startTime;
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Get basic health status
   */
  getBasicHealth() {
    const successRate = this.requestCount > 0
      ? ((this.successCount / this.requestCount) * 100).toFixed(2)
      : '100.00';

    return {
      status: 'healthy',
      uptime: this.getUptime(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      requests: {
        total: this.requestCount,
        success: this.successCount,
        errors: this.errorCount,
        successRate: `${successRate}%`
      }
    };
  }

  /**
   * Get detailed health status
   */
  getDetailedHealth() {
    const basic = this.getBasicHealth();
    const avgLatency = this.requestCount > 0
      ? Math.round(this.totalLatency / this.requestCount)
      : 0;

    return {
      ...basic,
      performance: {
        avgLatencyMs: avgLatency,
        p50LatencyMs: this.calculatePercentile(50),
        p95LatencyMs: this.calculatePercentile(95),
        p99LatencyMs: this.calculatePercentile(99),
      },
      memory: HEALTH_CONFIG.includeMemory ? {
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(process.memoryUsage().heapTotal / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
        external: `${Math.round(process.memoryUsage().external / 1024 / 1024)}MB`,
      } : undefined,
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
      }
    };
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

const healthMonitor = new HealthMonitor();

/**
 * Patch fetch to intercept health endpoint requests
 */
/**
 * Health check fetch interceptor.
 * Intercepts /api/health requests and tracks all other request metrics.
 */
async function healthCheckInterceptor(url, options, next) {
  const urlString = typeof url === 'string' ? url : url?.url || '';

  // Handle health endpoint requests
  if (urlString.includes(HEALTH_CONFIG.endpoint)) {
    const isDetailed = urlString.includes('/detailed');
    const healthData = isDetailed
      ? healthMonitor.getDetailedHealth()
      : healthMonitor.getBasicHealth();

    return new Response(JSON.stringify(healthData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      }
    });
  }

  // Track other requests
  const startTime = Date.now();

  try {
    const response = await next(url, options);
    const latency = Date.now() - startTime;
    healthMonitor.recordRequest(latency, response.ok);
    return response;
  } catch (error) {
    const latency = Date.now() - startTime;
    healthMonitor.recordRequest(latency, false);
    throw error;
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  if (global.__patchHooks) {
    // Priority 10 — run early to track all requests
    global.__patchHooks.registerFetchInterceptor('health-check', healthCheckInterceptor, { priority: 10 });
  } else {
    console.error('[health-check] ✖ patch-hooks not loaded — health-check will not work');
  }

  global.healthMonitor = healthMonitor;
  console.log('[health-check] 🚀 Health check active');
  console.log(`[health-check] 📊 Endpoints:`);
  console.log(`  - GET ${HEALTH_CONFIG.endpoint} (basic)`);
  console.log(`  - GET ${HEALTH_CONFIG.endpoint}/detailed (full)`);
}

// Apply patch when module is loaded
applyPatch();
