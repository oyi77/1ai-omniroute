/**
 * OpenClaw OmniRoute Modular Patch: Semantic Caching (Fetch-Based)
 * ================================================================
 * Caches responses based on semantic similarity of queries at the fetch layer.
 * 
 * Features:
 * - Embedding-based query similarity
 * - Configurable similarity threshold
 * - Multiple embedding providers support
 * - Works with npm install AND git clone/self-build
 * - Compatible with Next.js streaming responses
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const SEMANTIC_CACHE_CONFIG = {
  enabled: true,
  similarityThreshold: 0.85, // 85% similarity
  maxCacheSize: 500,
  ttl: 30 * 60 * 1000, // 30 minutes
  embeddingProvider: 'local', // 'local', 'openai', 'ollama'
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  cacheablePaths: ['/v1/chat/completions', '/v1/completions'],
};

// ─── Embedding Providers ─────────────────────────────────────────────────────

class EmbeddingProvider {
  constructor(provider = 'local') {
    this.provider = provider;
  }
  
  /**
   * Get embedding for text
   */
  async getEmbedding(text) {
    switch (this.provider) {
      case 'local':
        return this.getLocalEmbedding(text);
      case 'openai':
        return this.getOpenAIEmbedding(text);
      case 'ollama':
        return this.getOllamaEmbedding(text);
      default:
        return this.getLocalEmbedding(text);
    }
  }
  
  /**
   * Local embedding (simplified hash-based)
   */
  getLocalEmbedding(text) {
    // Simple hash-based embedding for demo
    // In production, use a proper embedding model
    const words = text.toLowerCase().split(/\s+/);
    const embedding = new Array(384).fill(0);
    
    words.forEach((word) => {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(i);
        hash = hash & hash;
      }
      const position = Math.abs(hash) % 384;
      embedding[position] = 1;
    });
    
    return embedding;
  }
  
  /**
   * OpenAI embedding (requires API key)
   */
  async getOpenAIEmbedding(text) {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          input: text,
          model: 'text-embedding-ada-002'
        })
      });
      
      const data = await response.json();
      return data.data[0].embedding;
    } catch (e) {
      console.error('[semantic-cache] OpenAI embedding failed:', e.message);
      return this.getLocalEmbedding(text);
    }
  }
  
  /**
   * Ollama embedding
   */
  async getOllamaEmbedding(text) {
    try {
      const response = await fetch('http://localhost:11434/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          prompt: text
        })
      });
      
      const data = await response.json();
      return data.embedding;
    } catch (e) {
      console.error('[semantic-cache] Ollama embedding failed:', e.message);
      return this.getLocalEmbedding(text);
    }
  }
}

// ─── Semantic Cache Implementation ───────────────────────────────────────────

class SemanticCache {
  constructor(config = {}) {
    this.config = { ...SEMANTIC_CACHE_CONFIG, ...config };
    this.cache = new Map();
    this.embeddings = new Map(); // Cache embeddings
    this.embeddingProvider = new EmbeddingProvider(this.config.embeddingProvider);
    this.hits = 0;
    this.misses = 0;
    
    // Start cleanup interval
    if (this.config.enabled) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, this.config.cleanupInterval);
    }
  }
  
  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  /**
   * Generate cache key from query
   */
  generateKey(query, model) {
    return `${model}:${query.toLowerCase().trim()}`;
  }
  
  /**
   * Find similar cached query
   */
  async findSimilar(query, model) {
    if (!this.config.enabled || !query) return null;
    
    // Get embedding for query
    const queryEmbedding = await this.embeddingProvider.getEmbedding(query);
    
    let bestMatch = null;
    let bestSimilarity = 0;
    
    // Compare with all cached queries
    for (const [key, entry] of this.cache.entries()) {
      // Check if same model
      if (!key.startsWith(`${model}:`)) continue;
      
      // Check if expired
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        continue;
      }
      
      // Get cached embedding
      let cachedEmbedding = this.embeddings.get(key);
      if (!cachedEmbedding) {
        // Regenerate embedding
        const cachedQuery = key.split(':').slice(1).join(':');
        cachedEmbedding = await this.embeddingProvider.getEmbedding(cachedQuery);
        this.embeddings.set(key, cachedEmbedding);
      }
      
      // Calculate similarity
      const similarity = this.cosineSimilarity(queryEmbedding, cachedEmbedding);
      
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }
    
    // Check threshold
    if (bestSimilarity >= this.config.similarityThreshold) {
      this.hits++;
      console.log(`[semantic-cache] ✅ Semantic HIT (similarity: ${(bestSimilarity * 100).toFixed(2)}%)`);
      return bestMatch.data;
    }
    
    this.misses++;
    return null;
  }
  
  /**
   * Set cached response
   */
  async set(query, model, data) {
    if (!this.config.enabled || !query) return;
    
    const key = this.generateKey(query, model);
    
    // Check size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.embeddings.delete(oldestKey);
    }
    
    // Store response
    this.cache.set(key, {
      data,
      query,
      model,
      expiresAt: Date.now() + this.config.ttl,
      createdAt: Date.now()
    });
    
    // Store embedding
    const embedding = await this.embeddingProvider.getEmbedding(query);
    this.embeddings.set(key, embedding);
    
    console.log(`[semantic-cache] 💾 Cached response for query (${this.cache.size} entries)`);
  }
  
  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.embeddings.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[semantic-cache] 🧹 Cleaned ${cleaned} expired entries`);
    }
  }
  
  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0 
        ? (this.hits / (this.hits + this.misses) * 100).toFixed(2) + '%'
        : '0%',
      similarityThreshold: this.config.similarityThreshold,
      embeddingProvider: this.config.embeddingProvider
    };
  }
  
  /**
   * Clear cache
   */
  clear() {
    this.cache.clear();
    this.embeddings.clear();
    this.hits = 0;
    this.misses = 0;
    console.log('[semantic-cache] 🗑️ Cache cleared');
  }
  
  /**
   * Destroy cache
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.clear();
  }
}

// ─── Patch Logic ─────────────────────────────────────────────────────────────

// Create global semantic cache instance
const semanticCache = new SemanticCache();

/**
 * Patch fetch to add semantic caching at the API call layer
 * This avoids conflicts with Next.js streaming responses
 */
function patchFetch() {
  try {
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = async function patchedFetch(url, options = {}) {
      // Check if this is a cacheable request
      const urlString = typeof url === 'string' ? url : url?.url || '';
      const isCacheable = SEMANTIC_CACHE_CONFIG.cacheablePaths.some(path => 
        urlString.includes(path)
      );
      
      if (isCacheable && options.method === 'POST' && options.body) {
        try {
          // Parse request body
          let body;
          if (typeof options.body === 'string') {
            body = JSON.parse(options.body);
          } else {
            body = options.body;
          }
          
          // Extract query from messages
          const query = body?.messages
            ?.filter(m => m.role === 'user')
            ?.map(m => m.content)
            ?.join(' ') || '';
          const model = body?.model || 'default';
          
          // Try to get from semantic cache
          const cachedResponse = await semanticCache.findSimilar(query, model);
          
          if (cachedResponse) {
            // Return cached response as a Response object
            return new Response(JSON.stringify(cachedResponse), {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Cache': 'SEMANTIC-HIT',
                'X-Similarity': 'high'
              }
            });
          }
          
          // Make actual request
          const response = await originalFetch.call(this, url, options);
          
          // Cache successful responses
          if (response.ok) {
            try {
              // Clone response to read body without consuming it
              const clonedResponse = response.clone();
              const data = await clonedResponse.json();
              
              if (data.choices && data.choices.length > 0) {
                semanticCache.set(query, model, data);
              }
            } catch (e) {
              // Not JSON or error, don't cache
            }
          }
          
          return response;
          
        } catch (e) {
          // Error in caching logic, fall back to original fetch
          return originalFetch.call(this, url, options);
        }
      }
      
      // Non-cacheable request, use original fetch
      return originalFetch.call(this, url, options);
    };
    
    console.log('[semantic-cache] ✅ Fetch patched for semantic caching');
    
    // Export cache for external access
    global.semanticCache = semanticCache;
    
  } catch (e) {
    console.error('[semantic-cache] ✖ Failed to patch fetch:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchFetch();
  console.log('[semantic-cache] 🚀 Semantic caching active');
  console.log(`[semantic-cache] 📊 Config: Similarity=${SEMANTIC_CACHE_CONFIG.similarityThreshold}, TTL=${SEMANTIC_CACHE_CONFIG.ttl/1000}s`);
  console.log(`[semantic-cache] 📊 Embedding: ${SEMANTIC_CACHE_CONFIG.embeddingProvider}`);
  console.log('[semantic-cache] 📊 Cacheable paths:', SEMANTIC_CACHE_CONFIG.cacheablePaths.join(', '));
}

// Apply patch when module is loaded
applyPatch();
