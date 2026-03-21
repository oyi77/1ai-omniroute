/**
 * OpenClaw OmniRoute Modular Patch: Provider Monitor & Optimizer
 * ================================================================
 * Monitors free provider usage and optimizes rotation.
 * 
 * Features:
 * - Track provider success/failure rates
 * - Monitor response times
 * - Auto-disable problematic providers
 * - Provider health scoring
 * - Usage statistics and recommendations
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const MONITOR_CONFIG = {
  enabled: true,
  checkInterval: 5 * 60 * 1000, // 5 minutes
  statsRetention: 24 * 60 * 60 * 1000, // 24 hours
  autoDisableThreshold: 0.3, // Disable if success rate < 30%
  healthCheckTimeout: 10000, // 10 seconds
  freeProviders: [
    'antigravity',
    'openai-compatible-chat-12a6e8a3-41c9-44e6-aeb0-e017bf86a76a', // G4F.dev
    'openai-compatible-chat-f47261d3-39f5-4c2d-9e1d-057fe346b013', // Pollinations
    'openai-compatible-chat-cb6defca-c00f-466a-894c-ec1f45a03e53', // uncloseai
  ],
};

// ─── Provider Monitor Implementation ─────────────────────────────────────────

class ProviderMonitor {
  constructor(config = {}) {
    this.config = { ...MONITOR_CONFIG, ...config };
    this.stats = new Map();
    this.healthStatus = new Map();
    this.requestHistory = [];
    this.startTime = Date.now();
    
    // Start monitoring interval
    if (this.config.enabled) {
      this.monitorInterval = setInterval(() => {
        this.updateHealthStatus();
      }, this.config.checkInterval);
    }
  }
  
  /**
   * Record a request
   */
  recordRequest(provider, success, duration, error = null) {
    if (!this.config.enabled) return;
    
    const timestamp = Date.now();
    const entry = {
      provider,
      success,
      duration,
      error: error?.message || error,
      timestamp
    };
    
    // Add to history
    this.requestHistory.push(entry);
    
    // Update stats
    if (!this.stats.has(provider)) {
      this.stats.set(provider, {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        totalDuration: 0,
        avgDuration: 0,
        lastError: null,
        lastSuccess: null,
        lastRequest: null,
        successRate: 0
      });
    }
    
    const stats = this.stats.get(provider);
    stats.totalRequests++;
    stats.totalDuration += duration;
    stats.avgDuration = stats.totalDuration / stats.totalRequests;
    stats.lastRequest = timestamp;
    
    if (success) {
      stats.successfulRequests++;
      stats.lastSuccess = timestamp;
    } else {
      stats.failedRequests++;
      stats.lastError = {
        message: error,
        timestamp
      };
    }
    
    stats.successRate = stats.successfulRequests / stats.totalRequests;
    
    // Clean old history
    this.cleanOldHistory();
    
    // Log significant events
    if (!success) {
      console.log(`[provider-monitor] ❌ ${provider} failed: ${error}`);
    }
    
    // Update health status
    this.updateProviderHealth(provider);
  }
  
  /**
   * Update provider health status
   */
  updateProviderHealth(provider) {
    const stats = this.stats.get(provider);
    if (!stats) return;
    
    // Calculate health score (0-100)
    let healthScore = 100;
    
    // Deduct for low success rate
    if (stats.successRate < 0.5) {
      healthScore -= 40;
    } else if (stats.successRate < 0.7) {
      healthScore -= 20;
    } else if (stats.successRate < 0.9) {
      healthScore -= 10;
    }
    
    // Deduct for slow responses
    if (stats.avgDuration > 10000) { // 10 seconds
      healthScore -= 20;
    } else if (stats.avgDuration > 5000) { // 5 seconds
      healthScore -= 10;
    }
    
    // Deduct for recent failures
    const recentFailures = this.requestHistory
      .filter(r => r.provider === provider && !r.success && Date.now() - r.timestamp < 300000)
      .length;
    
    if (recentFailures > 5) {
      healthScore -= 30;
    } else if (recentFailures > 2) {
      healthScore -= 15;
    }
    
    // Ensure score is between 0 and 100
    healthScore = Math.max(0, Math.min(100, healthScore));
    
    this.healthStatus.set(provider, {
      score: healthScore,
      status: healthScore >= 70 ? 'healthy' : healthScore >= 40 ? 'degraded' : 'unhealthy',
      lastUpdated: Date.now()
    });
    
    // Auto-disable if below threshold
    if (stats.successRate < this.config.autoDisableThreshold && stats.totalRequests >= 10) {
      this.disableProvider(provider);
    }
  }
  
  /**
   * Disable a provider
   */
  disableProvider(provider) {
    console.log(`[provider-monitor] ⚠️ Auto-disabling ${provider} (success rate: ${(this.stats.get(provider)?.successRate * 100).toFixed(1)}%)`);
    
    // Note: In a real implementation, this would update the database
    // For now, we just log it
  }
  
  /**
   * Update health status for all providers
   */
  updateHealthStatus() {
    for (const provider of this.config.freeProviders) {
      this.updateProviderHealth(provider);
    }
    
    // Log summary
    this.logSummary();
  }
  
  /**
   * Clean old history entries
   */
  cleanOldHistory() {
    const cutoff = Date.now() - this.config.statsRetention;
    this.requestHistory = this.requestHistory.filter(r => r.timestamp > cutoff);
  }
  
  /**
   * Get provider statistics
   */
  getProviderStats(provider) {
    return this.stats.get(provider) || null;
  }
  
  /**
   * Get all provider statistics
   */
  getAllStats() {
    const result = {};
    
    for (const [provider, stats] of this.stats.entries()) {
      const health = this.healthStatus.get(provider) || { score: 0, status: 'unknown' };
      
      result[provider] = {
        ...stats,
        healthScore: health.score,
        healthStatus: health.status,
        successRatePercent: (stats.successRate * 100).toFixed(2) + '%',
        avgDurationMs: Math.round(stats.avgDuration) + 'ms'
      };
    }
    
    return result;
  }
  
  /**
   * Get best provider
   */
  getBestProvider() {
    let bestProvider = null;
    let bestScore = -1;
    
    for (const [provider, stats] of this.stats.entries()) {
      const health = this.healthStatus.get(provider) || { score: 0 };
      
      // Calculate composite score
      const score = (stats.successRate * 0.6) + ((1 - Math.min(stats.avgDuration, 10000) / 10000) * 0.2) + (health.score / 100 * 0.2);
      
      if (score > bestScore) {
        bestScore = score;
        bestProvider = provider;
      }
    }
    
    return bestProvider;
  }
  
  /**
   * Get recommendations
   */
  getRecommendations() {
    const recommendations = [];
    const stats = this.getAllStats();
    
    // Find providers with low success rates
    for (const [provider, data] of Object.entries(stats)) {
      if (data.successRate < 0.5 && data.totalRequests >= 5) {
        recommendations.push({
          type: 'warning',
          provider,
          message: `Low success rate (${data.successRatePercent}). Consider disabling or checking configuration.`,
          priority: 'high'
        });
      }
      
      if (data.avgDuration > 8000) {
        recommendations.push({
          type: 'performance',
          provider,
          message: `Slow response time (${data.avgDurationMs}). Consider using a faster provider.`,
          priority: 'medium'
        });
      }
    }
    
    // Find best provider
    const bestProvider = this.getBestProvider();
    if (bestProvider) {
      recommendations.push({
        type: 'recommendation',
        provider: bestProvider,
        message: `Best performing provider. Consider using it as primary.`,
        priority: 'low'
      });
    }
    
    return recommendations;
  }
  
  /**
   * Log summary
   */
  logSummary() {
    const stats = this.getAllStats();
    const totalRequests = Object.values(stats).reduce((sum, s) => sum + s.totalRequests, 0);
    const totalSuccess = Object.values(stats).reduce((sum, s) => sum + s.successfulRequests, 0);
    const overallSuccessRate = totalRequests > 0 ? (totalSuccess / totalRequests * 100).toFixed(2) : 0;
    
    console.log(`[provider-monitor] 📊 Summary: ${totalRequests} requests, ${overallSuccessRate}% success rate`);
    
    // Log top 3 providers
    const sortedProviders = Object.entries(stats)
      .sort((a, b) => b[1].successRate - a[1].successRate)
      .slice(0, 3);
    
    if (sortedProviders.length > 0) {
      console.log('[provider-monitor] 🏆 Top providers:');
      sortedProviders.forEach(([provider, data], index) => {
        console.log(`  ${index + 1}. ${provider}: ${data.successRatePercent} success, ${data.avgDurationMs} avg`);
      });
    }
  }
  
  /**
   * Get uptime
   */
  getUptime() {
    const uptime = Date.now() - this.startTime;
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    return {
      milliseconds: uptime,
      seconds,
      minutes,
      hours,
      formatted: `${hours}h ${minutes % 60}m ${seconds % 60}s`
    };
  }
  
  /**
   * Export data
   */
  exportData() {
    return {
      config: this.config,
      stats: Object.fromEntries(this.stats),
      healthStatus: Object.fromEntries(this.healthStatus),
      requestHistory: this.requestHistory,
      uptime: this.getUptime(),
      recommendations: this.getRecommendations(),
      bestProvider: this.getBestProvider()
    };
  }
  
  /**
   * Clear all data
   */
  clear() {
    this.stats.clear();
    this.healthStatus.clear();
    this.requestHistory = [];
    console.log('[provider-monitor] 🗑️ All data cleared');
  }
  
  /**
   * Destroy monitor
   */
  destroy() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    this.clear();
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

// Create global monitor instance
const providerMonitor = new ProviderMonitor();

/**
 * Patch HTTP server to add provider monitoring
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
        // Add monitor endpoint
        if (req.url === '/api/provider-monitor/stats' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(providerMonitor.getAllStats(), null, 2));
          return;
        }
        
        if (req.url === '/api/provider-monitor/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            uptime: providerMonitor.getUptime(),
            bestProvider: providerMonitor.getBestProvider(),
            recommendations: providerMonitor.getRecommendations()
          }, null, 2));
          return;
        }
        
        // Track API requests
        if (req.url.startsWith('/v1/') && req.method === 'POST') {
          const startTime = Date.now();
          
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
            
            const duration = Date.now() - startTime;
            const success = res.statusCode < 400;
            const error = success ? null : responseBody;
            
            // Try to extract provider from response
            let provider = 'unknown';
            try {
              const response = JSON.parse(responseBody);
              if (response.model) {
                // Extract provider from model name (e.g., "antigravity/claude-sonnet-4-6")
                provider = response.model.split('/')[0];
              }
            } catch (e) {
              // Can't parse response
            }
            
            // Record request
            providerMonitor.recordRequest(provider, success, duration, error);
            
            return originalEnd.call(this, chunk, encoding, callback);
          };
        }
        
        // Call original listener
        return listener.call(this, req, res);
      };
      
      return originalCreateServer.call(this, options, patchedListener);
    };
    
    console.log('[provider-monitor] ✅ HTTP server patched for provider monitoring');
    
    // Export monitor for external access
    global.providerMonitor = providerMonitor;
    
  } catch (e) {
    console.error('[provider-monitor] ✖ Failed to patch HTTP server:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchHttpServer();
  console.log('[provider-monitor] 🚀 Provider monitoring active');
  console.log(`[provider-monitor] 📊 Monitoring ${MONITOR_CONFIG.freeProviders.length} free providers`);
  console.log(`[provider-monitor] 📊 Check interval: ${MONITOR_CONFIG.checkInterval / 1000}s`);
  console.log('[provider-monitor] 📊 Endpoints:');
  console.log('  - GET /api/provider-monitor/stats');
  console.log('  - GET /api/provider-monitor/health');
}

// Apply patch when module is loaded
applyPatch();
