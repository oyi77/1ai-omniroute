/**
 * OpenClaw OmniRoute Modular Patch: Semantic Caching (Fetch-Based)
 * FIXED: Skip streaming/SSE responses to prevent hang
 */

'use strict';

const SEMANTIC_CACHE_CONFIG = {
  enabled: true,
  similarityThreshold: 0.85,
  maxCacheSize: 500,
  ttl: 30 * 60 * 1000,
  embeddingProvider: 'local',
  cleanupInterval: 5 * 60 * 1000,
  cacheablePaths: ['/v1/chat/completions', '/v1/completions'],
};

class EmbeddingProvider {
  constructor(provider = 'local') {
    this.provider = provider;
  }

  async getEmbedding(text) {
    return this.getLocalEmbedding(text);
  }

  getLocalEmbedding(text) {
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(384).fill(0);
    words.forEach((word) => {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(i);
        hash = hash & hash;
      }
      embedding[Math.abs(hash) % 384] = 1;
    });
    return embedding;
  }
}

class SemanticCache {
  constructor(config = {}) {
    this.config = { ...SEMANTIC_CACHE_CONFIG, ...config };
    this.cache = new Map();
    this.embeddings = new Map();
    this.embeddingProvider = new EmbeddingProvider(this.config.embeddingProvider);
    this.hits = 0;
    this.misses = 0;
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(() => this.cleanup(), this.config.cleanupInterval);
    }
  }

  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  generateKey(query, model) {
    return `${model}:${query.toLowerCase().trim()}`;
  }

  async findSimilar(query, model) {
    if (!this.config.enabled || !query) return null;
    const queryEmbedding = await this.embeddingProvider.getEmbedding(query);
    let bestMatch = null, bestSimilarity = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (!key.startsWith(`${model}:`)) continue;
      if (Date.now() > entry.expiresAt) { this.cache.delete(key); continue; }
      let cachedEmbedding = this.embeddings.get(key);
      if (!cachedEmbedding) {
        const cachedQuery = key.split(':').slice(1).join(':');
        cachedEmbedding = await this.embeddingProvider.getEmbedding(cachedQuery);
        this.embeddings.set(key, cachedEmbedding);
      }
      const similarity = this.cosineSimilarity(queryEmbedding, cachedEmbedding);
      if (similarity > bestSimilarity) { bestSimilarity = similarity; bestMatch = entry; }
    }

    if (bestSimilarity >= this.config.similarityThreshold) {
      this.hits++;
      console.log(`[semantic-cache] ✅ Semantic HIT (${(bestSimilarity * 100).toFixed(2)}%)`);
      return bestMatch.data;
    }
    this.misses++;
    return null;
  }

  async set(query, model, data) {
    if (!this.config.enabled || !query) return;
    const key = this.generateKey(query, model);
    if (this.cache.size >= this.config.maxCacheSize) {
      const oldKey = this.cache.keys().next().value;
      this.cache.delete(oldKey);
      this.embeddings.delete(oldKey);
    }
    this.cache.set(key, { data, query, model, expiresAt: Date.now() + this.config.ttl });
    const embedding = await this.embeddingProvider.getEmbedding(query);
    this.embeddings.set(key, embedding);
    console.log(`[semantic-cache] 💾 Cached (${this.cache.size} entries)`);
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) { this.cache.delete(key); this.embeddings.delete(key); cleaned++; }
    }
    if (cleaned > 0) console.log(`[semantic-cache] 🧹 Cleaned ${cleaned} entries`);
  }
}

const semanticCache = new SemanticCache();

function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async function patchedFetch(url, options = {}) {
      const urlString = typeof url === 'string' ? url : url?.url || '';
      const isCacheable = SEMANTIC_CACHE_CONFIG.cacheablePaths.some(path => urlString.includes(path));

      if (isCacheable && options.method === 'POST' && options.body) {
        try {
          let body;
          try {
            body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
          } catch (e) {
            return originalFetch.call(this, url, options);
          }

          // CRITICAL FIX: Never intercept streaming requests
          if (body?.stream === true) {
            return originalFetch.call(this, url, options);
          }

          const query = body?.messages
            ?.filter(m => m.role === 'user')
            ?.map(m => typeof m.content === 'string' ? m.content : '')
            ?.join(' ') || '';
          const model = body?.model || 'default';

          if (query) {
            const cachedResponse = await semanticCache.findSimilar(query, model);
            if (cachedResponse) {
              return new Response(JSON.stringify(cachedResponse), {
                status: 200,
                headers: { 'Content-Type': 'application/json', 'X-Cache': 'SEMANTIC-HIT' }
              });
            }
          }

          const response = await originalFetch.call(this, url, options);

          // CRITICAL FIX: Only cache non-streaming JSON responses
          if (response.ok && query) {
            const contentType = response.headers.get('content-type') || '';
            const isStreaming = contentType.includes('text/event-stream') ||
                                contentType.includes('text/stream');
            if (!isStreaming) {
              try {
                const clonedResponse = response.clone();
                const data = await clonedResponse.json();
                if (data && data.choices && data.choices.length > 0) {
                  await semanticCache.set(query, model, data);
                }
              } catch (e) {
                // Not JSON, skip
              }
            }
          }

          return response;
        } catch (e) {
          return originalFetch.call(this, url, options);
        }
      }

      return originalFetch.call(this, url, options);
    };

    console.log('[semantic-cache] ✅ Fetch patched for semantic caching (streaming-safe)');
    global.semanticCache = semanticCache;
  } catch (e) {
    console.error('[semantic-cache] ✖ Failed to patch fetch:', e.message);
  }
}

function applyPatch() {
  patchFetch();
  console.log('[semantic-cache] 🚀 Semantic caching active (streaming-safe)');
}

applyPatch();
