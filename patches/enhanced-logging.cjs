/**
 * OpenClaw OmniRoute Modular Patch: Enhanced Logging
 * FIXED: Don't buffer/intercept streaming responses - only log metadata
 */

'use strict';

const LOG_CONFIG = {
  enabled: true,
  logRequests: true,
  logResponses: true,
  logErrors: true,
  logPerformance: true,
  logFile: '/home/openclaw/.omniroute/omniroute.log',
  maxFileSize: 10 * 1024 * 1024,
  maxFiles: 5,
};

class EnhancedLogger {
  constructor(config = {}) {
    this.config = { ...LOG_CONFIG, ...config };
    this.requestCount = 0;
    this.errorCount = 0;
    this.totalTokens = 0;
    this.startTime = Date.now();
    this.fs = require('fs');
    this.path = require('path');
    if (this.config.logFile) {
      const logDir = this.path.dirname(this.config.logFile);
      if (!this.fs.existsSync(logDir)) {
        this.fs.mkdirSync(logDir, { recursive: true });
      }
    }
  }

  log(level, message, data = {}) {
    if (!this.config.enabled) return;
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, ...data };
    const consoleMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (level === 'error') console.error(consoleMessage, data);
    else if (level === 'warn') console.warn(consoleMessage, data);
    else console.log(consoleMessage, data);
    if (this.config.logFile) this.writeToFile(logEntry);
  }

  writeToFile(logEntry) {
    try {
      const logLine = JSON.stringify(logEntry) + '\n';
      if (this.fs.existsSync(this.config.logFile)) {
        const stats = this.fs.statSync(this.config.logFile);
        if (stats.size > this.config.maxFileSize) this.rotateLogFile();
      }
      this.fs.appendFileSync(this.config.logFile, logLine);
    } catch (e) {
      // Silently skip log write errors
    }
  }

  rotateLogFile() {
    try {
      for (let i = this.config.maxFiles - 1; i > 0; i--) {
        const oldFile = `${this.config.logFile}.${i}`;
        const newFile = `${this.config.logFile}.${i + 1}`;
        if (this.fs.existsSync(oldFile)) this.fs.renameSync(oldFile, newFile);
      }
      if (this.fs.existsSync(this.config.logFile)) {
        this.fs.renameSync(this.config.logFile, `${this.config.logFile}.1`);
      }
    } catch (e) { }
  }

  logRequest(req, requestId) {
    if (!this.config.logRequests) return;
    this.requestCount++;
    this.log('info', `📥 Request #${this.requestCount}`, {
      requestId,
      method: req.method,
      url: req.url,
      contentType: req.headers['content-type'],
      timestamp: new Date().toISOString()
    });
  }

  // CRITICAL FIX: logResponse now takes pre-parsed metadata, never touches body stream
  logResponse(req, res, requestId, duration, statusCode) {
    if (!this.config.logResponses) return;
    this.log('info', `📤 Response #${this.requestCount}`, {
      requestId,
      statusCode,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  }

  logError(req, error, requestId) {
    this.errorCount++;
    this.log('error', `❌ Error #${this.errorCount}`, {
      requestId,
      error: error.message || error,
      url: req.url,
      timestamp: new Date().toISOString()
    });
  }

  logPerformance() {
    if (!this.config.logPerformance) return;
    const uptime = Date.now() - this.startTime;
    const s = Math.floor(uptime / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    this.log('info', '📊 Performance Metrics', {
      uptime: `${h}h ${m % 60}m ${s % 60}s`,
      totalRequests: this.requestCount,
      totalErrors: this.errorCount,
      errorRate: this.requestCount > 0
        ? ((this.errorCount / this.requestCount) * 100).toFixed(2) + '%'
        : '0%',
      totalTokens: this.totalTokens
    });
  }
}

const enhancedLogger = new EnhancedLogger();

/**
 * Enhanced logging middleware handler.
 * Logs request metadata and response status/timing without touching body streams.
 */
function enhancedLoggingMiddleware(req, res, next) {
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = requestId;

  enhancedLogger.logRequest(req, requestId);
  const startTime = Date.now();

  // Hook res.end for status code + timing only — NO body buffering (streaming-safe)
  const originalEnd = res.end;
  res.end = function (chunk, encoding, callback) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    enhancedLogger.logResponse(req, res, requestId, duration, statusCode);
    if (statusCode >= 400) {
      enhancedLogger.logError(req, { message: `HTTP ${statusCode}` }, requestId);
    }

    return originalEnd.call(this, chunk, encoding, callback);
  };

  next();
}

function applyPatch() {
  if (global.__patchHooks) {
    // Priority 5 — run very early to capture all request timing
    global.__patchHooks.registerHttpMiddleware('enhanced-logging', enhancedLoggingMiddleware, { priority: 5 });
  } else {
    console.error('[enhanced-logging] ✖ patch-hooks not loaded — enhanced-logging will not work');
  }

  global.enhancedLogger = enhancedLogger;
  setInterval(() => enhancedLogger.logPerformance(), 5 * 60 * 1000);
  console.log('[enhanced-logging] 🚀 Enhanced logging active (streaming-safe)');
}

applyPatch();
