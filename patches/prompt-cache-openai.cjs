/**
 * OpenClaw OmniRoute Patch: OpenAI Extended Prompt Caching
 * =========================================================
 * Maximizes OpenAI's automatic prompt caching by:
 * 1. Adding prompt_cache_retention: "24h" — extends cache from 5min to 24h
 * 2. Adding prompt_cache_key per model — improves routing to same server (higher hit rate)
 *
 * OpenAI caching is automatic for prompts ≥1024 tokens.
 * This patch just maximizes the hit rate and duration.
 *
 * Cost model:
 * - Cache READ: 50% cheaper than normal input tokens
 * - No extra charge for cache writes
 * - 24h retention vs default 5-10 min = much higher hit rate
 *
 * Supported models (extended retention):
 * gpt-5.x, gpt-4.1, gpt-4o and newer
 *
 * STREAMING-SAFE: Does not touch response body.
 */

'use strict';

const OPENAI_PROVIDERS = ['openai', 'codex', 'cx', 'laozhang'];
const OPENAI_MODEL_PREFIXES = ['gpt-', 'o1', 'o3', 'o4'];

// Models that support 24h extended retention
const EXTENDED_RETENTION_MODELS = [
  'gpt-5', 'gpt-4.1', 'gpt-4o', 'gpt-4-turbo', 'o1', 'o3', 'o4'
];

let stats = { injected: 0, skipped: 0, alreadyHas: 0 };

function isOpenAIRequest(body) {
  if (!body || !body.model) return false;
  const model = String(body.model).toLowerCase();

  for (const provider of OPENAI_PROVIDERS) {
    if (model.startsWith(`${provider}/`)) return true;
  }

  for (const prefix of OPENAI_MODEL_PREFIXES) {
    if (model.startsWith(prefix)) return true;
  }

  return false;
}

function supportsExtendedRetention(modelStr) {
  const model = modelStr.toLowerCase();
  return EXTENDED_RETENTION_MODELS.some(m => model.includes(m));
}

function getCacheKey(body) {
  // Use model as routing hint — requests with same model go to same server
  const model = (body.model || 'default').replace(/[^a-z0-9-]/gi, '-');
  return `openclaw-${model}`;
}

function injectCacheHints(body) {
  if (body.prompt_cache_retention && body.prompt_cache_key) {
    stats.alreadyHas++;
    return body;
  }

  const modified = { ...body };

  // Add cache key for better routing (always beneficial)
  if (!modified.prompt_cache_key) {
    modified.prompt_cache_key = getCacheKey(body);
  }

  // Add 24h retention for supported models
  if (!modified.prompt_cache_retention && supportsExtendedRetention(body.model || '')) {
    modified.prompt_cache_retention = '24h';
  }

  stats.injected++;
  return modified;
}

function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      const isChatEndpoint = urlString.includes('/v1/chat/completions') ||
                             urlString.includes('/v1/responses');

      if (isChatEndpoint && options.method === 'POST' && options.body) {
        try {
          let body;
          try {
            body = typeof options.body === 'string'
              ? JSON.parse(options.body)
              : options.body;
          } catch (e) {
            return originalFetch.call(this, url, options);
          }

          if (isOpenAIRequest(body)) {
            const modified = injectCacheHints(body);
            if (modified !== body) {
              options = {
                ...options,
                body: JSON.stringify(modified),
              };
            }
          } else {
            stats.skipped++;
          }
        } catch (e) {
          // Fail open
        }
      }

      return originalFetch.call(this, url, options);
    };

    console.log('[prompt-cache-openai] ✅ OpenAI extended prompt cache hints active');
    global.openaiCacheStats = stats;

    setInterval(() => {
      if (stats.injected > 0) {
        console.log(`[prompt-cache-openai] 📊 Stats: injected=${stats.injected} skipped=${stats.skipped} alreadyHas=${stats.alreadyHas}`);
      }
    }, 10 * 60 * 1000);

  } catch (e) {
    console.error('[prompt-cache-openai] ✖ Failed to patch fetch:', e.message);
  }
}

function applyPatch() {
  patchFetch();
  console.log('[prompt-cache-openai] 🚀 OpenAI extended prompt caching enabled');
  console.log('[prompt-cache-openai] 💰 Expected savings: 50% on cached input tokens (24h retention)');
}

applyPatch();
