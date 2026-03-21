/**
 * OpenClaw OmniRoute Modular Patch: Request Logger
 * ==================================================
 * Logs all requests and responses to file for debugging.
 * 
 * Features:
 * - Request/response logging
 * - Error logging with stack traces
 * - Configurable log levels
 * - Log rotation
 * - Works with npm install AND git clone/self-build
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────

const LOGGER_CONFIG = {
  logDir: path.join(process.env.HOME || '/home/openclaw', '.omniroute', 'logs'),
  logFile: 'requests.log',
  errorFile: 'errors.log',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  logLevel: process.env.LOG_LEVEL || 'info', // debug, info, warn, error
  logRequestBody: false,
  logResponseBody: false,
  sensitiveHeaders: ['authorization', 'cookie', 'x-api-key'],
};

// ─── Logger Implementation ───────────────────────────────────────────────────

class RequestLogger {
  constructor(config = {}) {
    this.config = { ...LOGGER_CONFIG, ...config };
    this.ensureLogDir();
  }
  
  /**
   * Ensure log directory exists
   */
  ensureLogDir() {
    try {
      if (!fs.existsSync(this.config.logDir)) {
        fs.mkdirSync(this.config.logDir, { recursive: true });
      }
    } catch (e) {
      console.error('[request-logger] ✖ Failed to create log directory:', e.message);
    }
  }
  
  /**
   * Get log file path
   */
  getLogPath(filename) {
    return path.join(this.config.logDir, filename);
  }
  
  /**
   * Rotate log file if needed
   */
  rotateLog(filename) {
    const logPath = this.getLogPath(filename);
    
    try {
      if (fs.existsSync(logPath)) {
        const stats = fs.statSync(logPath);
        if (stats.size > this.config.maxFileSize) {
          // Rotate files
          for (let i = this.config.maxFiles - 1; i > 0; i--) {
            const oldPath = `${logPath}.${i}`;
            const newPath = `${logPath}.${i + 1}`;
            if (fs.existsSync(oldPath)) {
              fs.renameSync(oldPath, newPath);
            }
          }
          fs.renameSync(logPath, `${logPath}.1`);
        }
      }
    } catch (e) {
      // Rotation failed, continue anyway
    }
  }
  
  /**
   * Write log entry
   */
  writeLog(filename, entry) {
    const logPath = this.getLogPath(filename);
    
    try {
      this.rotateLog(filename);
      fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    } catch (e) {
      console.error(`[request-logger] ✖ Failed to write log: ${e.message}`);
    }
  }
  
  /**
   * Sanitize headers (remove sensitive data)
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    for (const key of this.config.sensitiveHeaders) {
      if (sanitized[key]) {
        sanitized[key] = '***REDACTED***';
      }
      if (sanitized[key.toLowerCase()]) {
        sanitized[key.toLowerCase()] = '***REDACTED***';
      }
    }
    return sanitized;
  }
  
  /**
   * Log request
   */
  logRequest(requestId, method, url, headers, body) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'request',
      requestId,
      method,
      url,
      headers: this.sanitizeHeaders(headers),
      body: this.config.logRequestBody ? body : undefined,
    };
    
    this.writeLog(this.config.logFile, entry);
  }
  
  /**
   * Log response
   */
  logResponse(requestId, statusCode, latency, headers, body) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'response',
      requestId,
      statusCode,
      latencyMs: latency,
      headers: this.sanitizeHeaders(headers),
      body: this.config.logResponseBody ? body : undefined,
    };
    
    this.writeLog(this.config.logFile, entry);
    
    // Also log errors to error file
    if (statusCode >= 400) {
      this.writeLog(this.config.errorFile, entry);
    }
  }
  
  /**
   * Log error
   */
  logError(requestId, error, context = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'error',
      requestId,
      error: error.message || String(error),
      stack: error.stack,
      context,
    };
    
    this.writeLog(this.config.errorFile, entry);
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

const logger = new RequestLogger();

/**
 * Patch fetch to log requests and responses
 */
function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const urlString = typeof url === 'string' ? url : url?.url || '';
      const method = options.method || 'GET';
      const headers = options.headers || {};
      
      // Log request
      logger.logRequest(requestId, method, urlString, headers, options.body);
      
      const startTime = Date.now();
      
      try {
        const response = await originalFetch.call(this, url, options);
        const latency = Date.now() - startTime;
        
        // Log response
        logger.logResponse(
          requestId, 
          response.status, 
          latency, 
          Object.fromEntries(response.headers.entries()),
          null // Don't log response body by default
        );
        
        return response;
      } catch (error) {
        const latency = Date.now() - startTime;
        logger.logError(requestId, error, { url: urlString, method });
        throw error;
      }
    };
    
    console.log('[request-logger] ✅ Fetch patched for request logging');
    
    // Export for external access
    global.requestLogger = logger;
    
  } catch (e) {
    console.error('[request-logger] ✖ Failed to patch fetch:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchFetch();
  console.log('[request-logger] 🚀 Request logging active');
  console.log(`[request-logger] 📊 Log directory: ${LOGGER_CONFIG.logDir}`);
  console.log(`[request-logger] 📊 Request log: ${LOGGER_CONFIG.logFile}`);
  console.log(`[request-logger] 📊 Error log: ${LOGGER_CONFIG.errorFile}`);
  console.log(`[request-logger] 📊 Log level: ${LOGGER_CONFIG.logLevel}`);
}

// Apply patch when module is loaded
applyPatch();
