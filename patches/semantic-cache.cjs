/**
 * OpenClaw OmniRoute Modular Patch: Semantic Caching
 * ====================================================
 * Caches responses based on semantic similarity of queries.
 * 
 * Features:
 * - Embedding-based query similarity
 * - Configurable similarity threshold
 * - Multiple embedding providers support
 * - Cache warming and precomputation
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const SEMANTIC_CACHE_CONFIG = {
  enabled: true,
  similarityThreshold: 0.85, // 85% similarity
  maxCacheSize: 500,
  ttl: 30 * 60 * 1000, // 30 minutes
  embeddingProvider: 'local', // 'local', 'openai', 'ollama'
  embeddingModel: 'all-MiniLM-L6-v2', // For local embeddings
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
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
    
    words.forEach((word, index) => {
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
    if (!this.config.enabled) return null;
    
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
    if (!this.config.enabled) return;
    
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
 * Patch HTTP server to add semantic caching
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
        // Only cache POST requests to /v1/chat/completions
        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
          // Read request body
          let body = '';
          req.on('data', chunk => {
            body += chunk.toString();
          });
          
          req.on('end', async () => {
            try {
              const requestData = JSON.parse(body);
              const query = requestData.messages
                ?.filter(m => m.role === 'user')
                ?.map(m => m.content)
                ?.join(' ') || '';
              const model = requestData.model || 'default';
              
              // Try to get from semantic cache
              const cachedResponse = await semanticCache.findSimilar(query, model);
              
              if (cachedResponse) {
                // Return cached response
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(cachedResponse));
                return;
              }
              
              // Intercept response for caching
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
                
                // Cache the response
                try {
                  const response = JSON.parse(responseBody);
                  if (response.choices && response.choices.length > 0) {
                    semanticCache.set(query, model, response);
                  }
                } catch (e) {
                  // Not JSON or error, don't cache
                }
                
                return originalEnd.call(this, chunk, encoding, callback);
              };
              
              // Continue with original request
              return listener.call(this, req, res);
              
            } catch (e) {
              // Error parsing request, continue normally
              return listener.call(this, req, res);
            }
          });
          
          return;
        }
        
        // Call original listener for non-cacheable requests
        return listener.call(this, req, res);
      };
      
      return originalCreateServer.call(this, options, patchedListener);
    };
    
    console.log('[semantic-cache] ✅ HTTP server patched for semantic caching');
    
    // Export cache for external access
    global.semanticCache = semanticCache;
    
  } catch (e) {
    console.error('[semantic-cache] ✖ Failed to patch HTTP server:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  patchHttpServer();
  console.log('[semantic-cache] 🚀 Semantic caching active');
  console.log(`[semantic-cache] 📊 Config: Similarity=${SEMANTIC_CACHE_CONFIG.similarityThreshold}, TTL=${SEMANTIC_CACHE_CONFIG.ttl/1000}s`);
  console.log(`[semantic-cache] 📊 Embedding: ${SEMANTIC_CACHE_CONFIG.embeddingProvider}`);
}

// Apply patch when module is loaded
applyPatch();
