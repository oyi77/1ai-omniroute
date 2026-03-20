/**
 * OpenClaw OmniRoute Modular Patch: Enhanced Logging
 * ====================================================
 * Adds detailed logging for requests, responses, and performance.
 * 
 * Features:
 * - Request/response logging with timing
 * - Provider and model tracking
 * - Token usage logging
 * - Error tracking
 * - Performance metrics
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const LOG_CONFIG = {
  enabled: true,
  logRequests: true,
  logResponses: true,
  logErrors: true,
  logPerformance: true,
  logFile: '/home/openclaw/.omniroute/omniroute.log',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
};

// ─── Logger Implementation ───────────────────────────────────────────────────

class EnhancedLogger {
  constructor(config = {}) {
    this.config = { ...LOG_CONFIG, ...config };
    this.requestCount = 0;
    this.errorCount = 0;
    this.totalTokens = 0;
    this.startTime = Date.now();
    
    // File logging
    this.fs = require('fs');
    this.path = require('path');
    
    if (this.config.logFile) {
      this.logDir = this.path.dirname(this.config.logFile);
      if (!this.fs.existsSync(this.logDir)) {
        this.fs.mkdirSync(this.logDir, { recursive: true });
      }
    }
  }
  
  /**
   * Log to console and file
   */
  log(level, message, data = {}) {
    if (!this.config.enabled) return;
    
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...data
    };
    
    // Console output
    const consoleMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (level === 'error') {
      console.error(consoleMessage, data);
    } else if (level === 'warn') {
      console.warn(consoleMessage, data);
    } else {
      console.log(consoleMessage, data);
    }
    
    // File logging
    if (this.config.logFile) {
      this.writeToFile(logEntry);
    }
  }
  
  /**
   * Write log entry to file
   */
  writeToFile(logEntry) {
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      
      // Check file size and rotate if needed
      if (this.fs.existsSync(this.config.logFile)) {
        const stats = this.fs.statSync(this.config.logFile);
        if (stats.size > this.config.maxFileSize) {
          this.rotateLogFile();
        }
      }
      
      this.fs.appendFileSync(this.config.logFile, logLine);
    } catch (e) {
      console.error('[enhanced-logging] Failed to write to log file:', e.message);
    }
  }
  
  /**
   * Rotate log file
   */
  rotateLogFile() {
    try {
      for (let i = this.config.maxFiles - 1; i > 0; i--) {
        const oldFile = `${this.config.logFile}.${i}`;
        const newFile = `${this.config.logFile}.${i + 1}`;
        if (this.fs.existsSync(oldFile)) {
          this.fs.renameSync(oldFile, newFile);
        }
      }
      if (this.fs.existsSync(this.config.logFile)) {
        this.fs.renameSync(this.config.logFile, `${this.config.logFile}.1`);
      }
    } catch (e) {
      console.error('[enhanced-logging] Failed to rotate log file:', e.message);
    }
  }
  
  /**
   * Log request
   */
  logRequest(req, requestId) {
    if (!this.config.logRequests) return;
    
    this.requestCount++;
    
    const requestInfo = {
      requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      contentType: req.headers['content-type'],
      authorization: req.headers['authorization'] ? 'present' : 'missing',
      timestamp: new Date().toISOString()
    };
    
    this.log('info', `📥 Request #${this.requestCount}`, requestInfo);
  }
  
  /**
   * Log response
   */
  logResponse(req, res, requestId, duration, body = {}) {
    if (!this.config.logResponses) return;
    
    const responseInfo = {
      requestId,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      model: body.model || 'unknown',
      provider: body.provider || 'unknown',
      tokens: body.usage || {},
      timestamp: new Date().toISOString()
    };
    
    // Track token usage
    if (body.usage) {
      this.totalTokens += (body.usage.total_tokens || 0);
    }
    
    this.log('info', `📤 Response #${this.requestCount}`, responseInfo);
  }
  
  /**
   * Log error
   */
  logError(req, error, requestId) {
    this.errorCount++;
    
    const errorInfo = {
      requestId,
      error: error.message || error,
      stack: error.stack,
      url: req.url,
      method: req.method,
      timestamp: new Date().toISOString()
    };
    
    this.log('error', `❌ Error #${this.errorCount}`, errorInfo);
  }
  
  /**
   * Log performance metrics
   */
  logPerformance() {
    if (!this.config.logPerformance) return;
    
    const uptime = Date.now() - this.startTime;
    const uptimeSeconds = Math.floor(uptime / 1000);
    const uptimeMinutes = Math.floor(uptimeSeconds / 60);
    const uptimeHours = Math.floor(uptimeMinutes / 60);
    
    const metrics = {
      uptime: `${uptimeHours}h ${uptimeMinutes % 60}m ${uptimeSeconds % 60}s`,
      totalRequests: this.requestCount,
      totalErrors: this.errorCount,
      errorRate: this.requestCount > 0 
        ? ((this.errorCount / this.requestCount) * 100).toFixed(2) + '%'
        : '0%',
      totalTokens: this.totalTokens,
      timestamp: new Date().toISOString()
    };
    
    this.log('info', '📊 Performance Metrics', metrics);
  }
  
  /**
   * Get statistics
   */
  getStats() {
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      totalTokens: this.totalTokens,
      errorRate: this.requestCount > 0 
        ? ((this.errorCount / this.requestCount) * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

// Create global logger instance
const enhancedLogger = new EnhancedLogger();

/**
 * Patch HTTP server to add enhanced logging
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
        // Generate request ID
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        req.requestId = requestId;
        
        // Log request
        enhancedLogger.logRequest(req, requestId);
        
        // Track timing
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
          
          // Calculate duration
          const duration = Date.now() - startTime;
          
          // Parse response body
          let parsedBody = {};
          try {
            parsedBody = JSON.parse(responseBody);
          } catch (e) {
            // Not JSON
          }
          
          // Log response
          enhancedLogger.logResponse(req, res, requestId, duration, parsedBody);
          
          // Log errors
          if (res.statusCode >= 400) {
            enhancedLogger.logError(req, {
              message: `HTTP ${res.statusCode}`,
              body: parsedBody
            }, requestId);
          }
          
          return originalEnd.call(this, chunk, encoding, callback);
        };
        
        // Call original listener
        return listener.call(this, req, res);
      };
      
      return originalCreateServer.call(this, options, patchedListener);
    };
    
    console.log('[enhanced-logging] ✅ HTTP server patched for enhanced logging');
    
    // Export logger for external access
    global.enhancedLogger = enhancedLogger;
    
    // Log performance metrics every 5 minutes
    setInterval(() => {
      enhancedLogger.logPerformance();
    }, 5 * 60 * 1000);
    
  } catch (e) {
    console.error('[enhanced-logging] ✖ Failed to patch HTTP server:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchHttpServer();
  console.log('[enhanced-logging] 🚀 Enhanced logging active');
  console.log(`[enhanced-logging] 📊 Log file: ${LOG_CONFIG.logFile}`);
  console.log(`[enhanced-logging] 📊 Config: Requests=${LOG_CONFIG.logRequests}, Responses=${LOG_CONFIG.logResponses}, Errors=${LOG_CONFIG.logErrors}`);
}

// Apply patch when module is loaded
applyPatch();
