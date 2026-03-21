/**
 * OpenClaw OmniRoute Modular Patch: Telegram Alerts
 * ==================================================
 * Sends alerts to Telegram on critical events.
 * 
 * Features:
 * - Provider failure alerts
 * - Rate limit alerts
 * - High latency alerts
 * - Configurable thresholds
 * - Works with npm install AND git clone/self-build
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const TELEGRAM_CONFIG = {
  enabled: process.env.TELEGRAM_BOT_TOKEN ? true : false,
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  alertThresholds: {
    errorRate: 0.5, // Alert if error rate > 50%
    latencyMs: 10000, // Alert if latency > 10s
    consecutiveFailures: 3, // Alert after 3 consecutive failures
  },
  cooldownMs: 5 * 60 * 1000, // 5 minutes between same alerts
};

// ─── Alert Manager ───────────────────────────────────────────────────────────

class AlertManager {
  constructor(config = {}) {
    this.config = { ...TELEGRAM_CONFIG, ...config };
    this.lastAlerts = new Map(); // Cooldown tracking
    this.consecutiveFailures = new Map();
  }
  
  /**
   * Check if alert should be sent (cooldown)
   */
  shouldSendAlert(alertType) {
    const lastAlert = this.lastAlerts.get(alertType);
    if (!lastAlert) return true;
    
    return (Date.now() - lastAlert) > this.config.cooldownMs;
  }
  
  /**
   * Send Telegram alert
   */
  async sendAlert(message, alertType = 'general') {
    if (!this.config.enabled) {
      console.log(`[telegram-alerts] ⚠️ Alert not sent (disabled): ${message}`);
      return false;
    }
    
    if (!this.shouldSendAlert(alertType)) {
      console.log(`[telegram-alerts] ⏰ Alert cooldown active for: ${alertType}`);
      return false;
    }
    
    try {
      const url = `https://api.telegram.org/bot${this.config.botToken}/sendMessage`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text: `🚨 *OmniRoute Alert*\n\n${message}`,
          parse_mode: 'Markdown',
        })
      });
      
      if (response.ok) {
        this.lastAlerts.set(alertType, Date.now());
        console.log(`[telegram-alerts] ✅ Alert sent: ${alertType}`);
        return true;
      } else {
        console.error(`[telegram-alerts] ✖ Failed to send alert: ${response.status}`);
        return false;
      }
    } catch (e) {
      console.error(`[telegram-alerts] ✖ Error sending alert: ${e.message}`);
      return false;
    }
  }
  
  /**
   * Track consecutive failures
   */
  trackFailure(provider) {
    const count = (this.consecutiveFailures.get(provider) || 0) + 1;
    this.consecutiveFailures.set(provider, count);
    
    if (count >= this.config.alertThresholds.consecutiveFailures) {
      this.sendAlert(
        `Provider *${provider}* failed ${count} times consecutively!`,
        `failure_${provider}`
      );
    }
    
    return count;
  }
  
  /**
   * Reset failure counter on success
   */
  trackSuccess(provider) {
    this.consecutiveFailures.set(provider, 0);
  }
  
  /**
   * Alert on rate limit
   */
  alertRateLimit(provider, accountsAffected, resetAfter) {
    this.sendAlert(
      `⚡ *Rate Limit Alert*\n\n` +
      `Provider: ${provider}\n` +
      `Accounts affected: ${accountsAffected}\n` +
      `Reset after: ${resetAfter}`,
      `ratelimit_${provider}`
    );
  }
  
  /**
   * Alert on high latency
   */
  alertHighLatency(provider, latencyMs) {
    if (latencyMs > this.config.alertThresholds.latencyMs) {
      this.sendAlert(
        `🐢 *High Latency Alert*\n\n` +
        `Provider: ${provider}\n` +
        `Latency: ${latencyMs}ms\n` +
        `Threshold: ${this.config.alertThresholds.latencyMs}ms`,
        `latency_${provider}`
      );
    }
  }
  
  /**
   * Alert on provider recovery
   */
  alertRecovery(provider) {
    this.sendAlert(
      `✅ *Provider Recovered*\n\n` +
      `Provider: ${provider}\n` +
      `Status: Back online`,
      `recovery_${provider}`
    );
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

const alertManager = new AlertManager();

/**
 * Patch fetch to monitor for alertable events
 */
function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      
      // Monitor API calls for failures
      try {
        const response = await originalFetch.call(this, url, options);
        
        // Extract provider from URL if possible
        const providerMatch = urlString.match(/\.([^.]+)\.(com|io|ai|org)/);
        const provider = providerMatch ? providerMatch[1] : 'unknown';
        
        if (!response.ok) {
          alertManager.trackFailure(provider);
        } else {
          alertManager.trackSuccess(provider);
        }
        
        return response;
      } catch (error) {
        const providerMatch = urlString.match(/\.([^.]+)\.(com|io|ai|org)/);
        const provider = providerMatch ? providerMatch[1] : 'unknown';
        alertManager.trackFailure(provider);
        throw error;
      }
    };
    
    console.log('[telegram-alerts] ✅ Fetch patched for alert monitoring');
    
    // Export for external access
    global.alertManager = alertManager;
    
  } catch (e) {
    console.error('[telegram-alerts] ✖ Failed to patch fetch:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchFetch();
  console.log('[telegram-alerts] 🚀 Telegram alerts active');
  console.log(`[telegram-alerts] 📊 Enabled: ${TELEGRAM_CONFIG.enabled}`);
  if (TELEGRAM_CONFIG.enabled) {
    console.log(`[telegram-alerts] 📊 Chat ID: ${TELEGRAM_CONFIG.chatId}`);
  } else {
    console.log('[telegram-alerts] 📊 Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable');
  }
}

// Apply patch when module is loaded
applyPatch();
