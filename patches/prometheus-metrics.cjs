/**
 * OpenClaw OmniRoute Modular Patch: Prometheus Metrics
 * =====================================================
 * Exposes metrics in Prometheus format for monitoring.
 * 
 * Features:
 * - Request count/latency metrics
 * - Provider health metrics
 * - Error rate tracking
 * - Works with npm install AND git clone/self-build
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const METRICS_CONFIG = {
  endpoint: '/metrics',
  prefix: 'omniroute_',
};

// ─── Metrics Collector ───────────────────────────────────────────────────────

class MetricsCollector {
  constructor(prefix = 'omniroute_') {
    this.prefix = prefix;
    this.counters = {};
    this.gauges = {};
    this.histograms = {};
  }
  
  /**
   * Increment counter
   */
  incrementCounter(name, labels = {}) {
    const key = this.getKey(name, labels);
    this.counters[key] = (this.counters[key] || 0) + 1;
  }
  
  /**
   * Set gauge value
   */
  setGauge(name, value, labels = {}) {
    const key = this.getKey(name, labels);
    this.gauges[key] = value;
  }
  
  /**
   * Record histogram value
   */
  recordHistogram(name, value, labels = {}) {
    const key = this.getKey(name, labels);
    if (!this.histograms[key]) {
      this.histograms[key] = [];
    }
    this.histograms[key].push(value);
    // Keep only last 1000 values
    if (this.histograms[key].length > 1000) {
      this.histograms[key].shift();
    }
  }
  
  /**
   * Get metric key with labels
   */
  getKey(name, labels) {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}}` : name;
  }
  
  /**
   * Generate Prometheus format output
   */
  toPrometheus() {
    let output = '';
    
    // Counters
    output += '# HELP ' + this.prefix + 'requests_total Total number of requests\n';
    output += '# TYPE ' + this.prefix + 'requests_total counter\n';
    for (const [key, value] of Object.entries(this.counters)) {
      output += `${this.prefix}${key} ${value}\n`;
    }
    
    // Gauges
    output += '\n# HELP ' + this.prefix + 'gauge Gauge metrics\n';
    output += '# TYPE ' + this.prefix + 'gauge gauge\n';
    for (const [key, value] of Object.entries(this.gauges)) {
      output += `${this.prefix}${key} ${value}\n`;
    }
    
    // Histograms (simplified)
    output += '\n# HELP ' + this.prefix + 'latency_ms Request latency in milliseconds\n';
    output += '# TYPE ' + this.prefix + 'latency_ms histogram\n';
    for (const [key, values] of Object.entries(this.histograms)) {
      if (values.length > 0) {
        const sorted = [...values].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const p99 = sorted[Math.floor(sorted.length * 0.99)];
        const sum = values.reduce((a, b) => a + b, 0);
        
        output += `${this.prefix}latency_ms${key}_bucket{le="500"} ${values.filter(v => v <= 500).length}\n`;
        output += `${this.prefix}latency_ms${key}_bucket{le="1000"} ${values.filter(v => v <= 1000).length}\n`;
        output += `${this.prefix}latency_ms${key}_bucket{le="5000"} ${values.filter(v => v <= 5000).length}\n`;
        output += `${this.prefix}latency_ms${key}_bucket{le="+Inf"} ${values.length}\n`;
        output += `${this.prefix}latency_ms${key}_sum ${sum}\n`;
        output += `${this.prefix}latency_ms${key}_count ${values.length}\n`;
      }
    }
    
    return output;
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

const metrics = new MetricsCollector(METRICS_CONFIG.prefix);

/**
 * Patch fetch to collect metrics
 */
function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      
      // Handle metrics endpoint
      if (urlString.includes(METRICS_CONFIG.endpoint)) {
        return new Response(metrics.toPrometheus(), {
          status: 200,
          headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }
        });
      }
      
      // Track other requests
      const startTime = Date.now();
      const method = options.method || 'GET';
      
      try {
        const response = await originalFetch.call(this, url, options);
        const latency = Date.now() - startTime;
        
        // Determine provider
        let provider = 'unknown';
        if (urlString.includes('antigravity')) provider = 'antigravity';
        else if (urlString.includes('qtcool')) provider = 'qtcool';
        else if (urlString.includes('ollama')) provider = 'ollama-cloud';
        else if (urlString.includes('nvidia')) provider = 'nvidia';
        else if (urlString.includes('claude')) provider = 'claude';
        
        // Record metrics
        metrics.incrementCounter('requests_total', { 
          method, 
          status: response.status,
          provider 
        });
        metrics.recordHistogram('latency_ms', latency, { provider });
        metrics.setGauge('last_request_timestamp', Date.now());
        
        if (!response.ok) {
          metrics.incrementCounter('errors_total', { 
            status: response.status,
            provider 
          });
        }
        
        return response;
      } catch (error) {
        metrics.incrementCounter('errors_total', { 
          type: 'network',
          provider: 'unknown' 
        });
        throw error;
      }
    };
    
    console.log('[prometheus-metrics] ✅ Fetch patched for metrics collection');
    
    // Export for external access
    global.metrics = metrics;
    
  } catch (e) {
    console.error('[prometheus-metrics] ✖ Failed to patch fetch:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchFetch();
  console.log('[prometheus-metrics] 🚀 Prometheus metrics active');
  console.log(`[prometheus-metrics] 📊 Endpoint: GET ${METRICS_CONFIG.endpoint}`);
  console.log(`[prometheus-metrics] 📊 Prefix: ${METRICS_CONFIG.prefix}`);
}

// Apply patch when module is loaded
applyPatch();
