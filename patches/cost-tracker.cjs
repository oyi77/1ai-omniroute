/**
 * OpenClaw OmniRoute Modular Patch: Cost Tracker
 * ================================================
 * Tracks API costs per request, provider, and time period.
 * 
 * Features:
 * - Per-request cost calculation
 * - Provider cost aggregation
 * - Daily/monthly cost tracking
 * - Budget alerts
 * - Works with npm install AND git clone/self-build
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const COST_CONFIG = {
  endpoint: '/api/costs',
  currency: 'USD',
  // Cost per 1K tokens (input/output) - approximate values
  modelCosts: {
    // OpenAI models
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-5.1': { input: 0.005, output: 0.015 },
    'gpt-5.1-codex': { input: 0.005, output: 0.015 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
    
    // Claude models
    'claude-opus-4-6': { input: 0.015, output: 0.075 },
    'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
    'claude-haiku': { input: 0.00025, output: 0.00125 },
    
    // Gemini models
    'gemini-2.5-flash': { input: 0.000075, output: 0.0003 },
    'gemini-2.5-pro': { input: 0.00125, output: 0.005 },
    'gemini-3-flash-preview': { input: 0.000075, output: 0.0003 },
    
    // Open source (free)
    'llama-3.3-70b-instruct': { input: 0, output: 0 },
    'deepseek-v3.2': { input: 0, output: 0 },
    'gemma3:27b': { input: 0, output: 0 },
    'qwen3-vl:235b-instruct': { input: 0, output: 0 },
    'kimi-k2.5': { input: 0, output: 0 },
    'gpt-oss-120b': { input: 0, output: 0 },
    
    // Default for unknown models
    'default': { input: 0.001, output: 0.002 },
  },
  budgetAlerts: {
    daily: parseFloat(process.env.DAILY_BUDGET) || 10, // $10/day default
    monthly: parseFloat(process.env.MONTHLY_BUDGET) || 200, // $200/month default
  }
};

// ─── Cost Tracker Implementation ─────────────────────────────────────────────

class CostTracker {
  constructor(config = {}) {
    this.config = { ...COST_CONFIG, ...config };
    this.costs = {
      total: 0,
      byProvider: {},
      byModel: {},
      byDay: {},
      byHour: {},
    };
    this.requestCount = 0;
  }
  
  /**
   * Get cost for model
   */
  getModelCost(model) {
    // Normalize model name
    const normalizedModel = model?.toLowerCase() || 'default';
    
    // Find matching cost config
    for (const [key, cost] of Object.entries(this.config.modelCosts)) {
      if (normalizedModel.includes(key.toLowerCase())) {
        return cost;
      }
    }
    
    return this.config.modelCosts.default;
  }
  
  /**
   * Calculate cost for a request
   */
  calculateCost(model, inputTokens, outputTokens) {
    const cost = this.getModelCost(model);
    const inputCost = (inputTokens / 1000) * cost.input;
    const outputCost = (outputTokens / 1000) * cost.output;
    return inputCost + outputCost;
  }
  
  /**
   * Record a request and its cost
   */
  recordRequest(provider, model, inputTokens, outputTokens, success = true) {
    const cost = this.calculateCost(model, inputTokens, outputTokens);
    const now = new Date();
    const dateKey = now.toISOString().split('T')[0];
    const hourKey = `${dateKey}T${String(now.getHours()).padStart(2, '0')}`;
    
    // Update totals
    this.costs.total += cost;
    this.requestCount++;
    
    // Update by provider
    if (!this.costs.byProvider[provider]) {
      this.costs.byProvider[provider] = { cost: 0, requests: 0, tokens: { input: 0, output: 0 } };
    }
    this.costs.byProvider[provider].cost += cost;
    this.costs.byProvider[provider].requests++;
    this.costs.byProvider[provider].tokens.input += inputTokens;
    this.costs.byProvider[provider].tokens.output += outputTokens;
    
    // Update by model
    if (!this.costs.byModel[model]) {
      this.costs.byModel[model] = { cost: 0, requests: 0, tokens: { input: 0, output: 0 } };
    }
    this.costs.byModel[model].cost += cost;
    this.costs.byModel[model].requests++;
    this.costs.byModel[model].tokens.input += inputTokens;
    this.costs.byModel[model].tokens.output += outputTokens;
    
    // Update by day
    if (!this.costs.byDay[dateKey]) {
      this.costs.byDay[dateKey] = { cost: 0, requests: 0 };
    }
    this.costs.byDay[dateKey].cost += cost;
    this.costs.byDay[dateKey].requests++;
    
    // Update by hour
    if (!this.costs.byHour[hourKey]) {
      this.costs.byHour[hourKey] = { cost: 0, requests: 0 };
    }
    this.costs.byHour[hourKey].cost += cost;
    this.costs.byHour[hourKey].requests++;
    
    // Check budget alerts
    this.checkBudgetAlerts(dateKey);
    
    return cost;
  }
  
  /**
   * Check budget alerts
   */
  checkBudgetAlerts(dateKey) {
    const dailyCost = this.costs.byDay[dateKey]?.cost || 0;
    const monthlyCost = Object.entries(this.costs.byDay)
      .filter(([key]) => key.startsWith(dateKey.substring(0, 7)))
      .reduce((sum, [, data]) => sum + data.cost, 0);
    
    if (dailyCost > this.config.budgetAlerts.daily) {
      console.log(`[cost-tracker] ⚠️ Daily budget exceeded: $${dailyCost.toFixed(2)} > $${this.config.budgetAlerts.daily}`);
    }
    
    if (monthlyCost > this.config.budgetAlerts.monthly) {
      console.log(`[cost-tracker] ⚠️ Monthly budget exceeded: $${monthlyCost.toFixed(2)} > $${this.config.budgetAlerts.monthly}`);
    }
  }
  
  /**
   * Get cost summary
   */
  getSummary(period = 'today') {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const thisMonth = today.substring(0, 7);
    
    let periodCost = 0;
    let periodRequests = 0;
    
    if (period === 'today') {
      periodCost = this.costs.byDay[today]?.cost || 0;
      periodRequests = this.costs.byDay[today]?.requests || 0;
    } else if (period === 'month') {
      Object.entries(this.costs.byDay).forEach(([key, data]) => {
        if (key.startsWith(thisMonth)) {
          periodCost += data.cost;
          periodRequests += data.requests;
        }
      });
    } else {
      periodCost = this.costs.total;
      periodRequests = this.requestCount;
    }
    
    return {
      period,
      total: `$${this.costs.total.toFixed(4)}`,
      periodCost: `$${periodCost.toFixed(4)}`,
      periodRequests,
      byProvider: Object.entries(this.costs.byProvider).map(([name, data]) => ({
        name,
        cost: `$${data.cost.toFixed(4)}`,
        requests: data.requests,
        tokens: data.tokens,
      })),
      byModel: Object.entries(this.costs.byModel).map(([name, data]) => ({
        name,
        cost: `$${data.cost.toFixed(4)}`,
        requests: data.requests,
        tokens: data.tokens,
      })),
      budget: {
        daily: `$${this.config.budgetAlerts.daily}`,
        monthly: `$${this.config.budgetAlerts.monthly}`,
        dailyUsed: `$${(this.costs.byDay[today]?.cost || 0).toFixed(4)}`,
        monthlyUsed: `$${Object.entries(this.costs.byDay)
          .filter(([key]) => key.startsWith(thisMonth))
          .reduce((sum, [, data]) => sum + data.cost, 0)
          .toFixed(4)}`,
      }
    };
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

const costTracker = new CostTracker();

/**
 * Patch fetch to track costs
 */
function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      
      // Handle cost endpoint
      if (urlString.includes(COST_CONFIG.endpoint)) {
        const urlObj = new URL(urlString, 'http://localhost');
        const period = urlObj.searchParams.get('period') || 'today';
        const summary = costTracker.getSummary(period);
        
        return new Response(JSON.stringify(summary, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      
      // Track other requests
      const startTime = Date.now();
      
      try {
        const response = await originalFetch.call(this, url, options);
        
        if (response.ok) {
          try {
            const cloned = response.clone();
            const data = await cloned.json();
            
            // Extract token usage from response
            const usage = data.usage || {};
            const inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
            const outputTokens = usage.completion_tokens || usage.output_tokens || 0;
            
            // Extract provider and model from request
            let provider = 'unknown';
            let model = 'unknown';
            
            if (options.body) {
              try {
                const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
                model = body.model || 'unknown';
              } catch (e) {}
            }
            
            // Determine provider from URL
            if (urlString.includes('antigravity')) provider = 'antigravity';
            else if (urlString.includes('qtcool')) provider = 'qtcool';
            else if (urlString.includes('ollama')) provider = 'ollama-cloud';
            else if (urlString.includes('nvidia')) provider = 'nvidia';
            else if (urlString.includes('claude') || urlString.includes('anthropic')) provider = 'claude';
            
            costTracker.recordRequest(provider, model, inputTokens, outputTokens);
          } catch (e) {
            // Not JSON or no usage data
          }
        }
        
        return response;
      } catch (error) {
        throw error;
      }
    };
    
    console.log('[cost-tracker] ✅ Fetch patched for cost tracking');
    
    // Export for external access
    global.costTracker = costTracker;
    
  } catch (e) {
    console.error('[cost-tracker] ✖ Failed to patch fetch:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchFetch();
  console.log('[cost-tracker] 🚀 Cost tracking active');
  console.log(`[cost-tracker] 📊 Endpoint: GET ${COST_CONFIG.endpoint}?period=today|month|all`);
  console.log(`[cost-tracker] 📊 Budget: $${COST_CONFIG.budgetAlerts.daily}/day, $${COST_CONFIG.budgetAlerts.monthly}/month`);
}

// Apply patch when module is loaded
applyPatch();
