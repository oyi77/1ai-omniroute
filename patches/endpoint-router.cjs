/**
 * OpenClaw OmniRoute Modular Patch: Enhanced Endpoint Router
 * ===========================================================
 * Adds and enhances endpoints for video, image, vision, audio, etc.
 * Ensures OmniRoute can handle all standard AI aggregator scenarios.
 * 
 * WHAT THIS PATCHES:
 * - Adds missing endpoint aliases (e.g., /v1/generate → /v1/images/generations)
 * - Enhances content-type detection for media endpoints
 * - Adds fallback routing for multimodal requests
 * 
 * MODULAR: Loaded automatically on OmniRoute startup
 * SURVIVES UPDATES: Re-applied on each startup
 */

'use strict';

// ─── Configuration ───────────────────────────────────────────────────────────

const ENDPOINT_MAP = {
  // Image generation aliases
  '/v1/generate': '/v1/images/generations',
  '/v1/image': '/v1/images/generations',
  '/v1/images': '/v1/images/generations',
  '/v1/dalle': '/v1/images/generations',
  '/v1/stable-diffusion': '/v1/images/generations',
  '/v1/midjourney': '/v1/images/generations',
  
  // Video generation aliases
  '/v1/video': '/v1/videos/generations',
  '/v1/sora': '/v1/videos/generations',
  '/v1/seedance': '/v1/videos/generations',
  '/v1/kling': '/v1/videos/generations',
  '/v1/runway': '/v1/videos/generations',
  '/v1/pika': '/v1/videos/generations',
  '/v1/animatediff': '/v1/videos/generations',
  
  // Vision/understanding aliases
  '/v1/vision': '/v1/chat/completions',
  '/v1/analyze': '/v1/chat/completions',
  '/v1/understand': '/v1/chat/completions',
  '/v1/describe': '/v1/chat/completions',
  '/v1/ocr': '/v1/chat/completions',
  
  // Audio aliases
  '/v1/transcribe': '/v1/audio/transcriptions',
  '/v1/speech': '/v1/audio/speech',
  '/v1/tts': '/v1/audio/speech',
  '/v1/stt': '/v1/audio/transcriptions',
  '/v1/whisper': '/v1/audio/transcriptions',
  
  // Embeddings aliases
  '/v1/embed': '/v1/embeddings',
  '/v1/vectorize': '/v1/embeddings',
  
  // Reranking aliases
  '/v1/rank': '/v1/rerank',
  '/v1/reranker': '/v1/rerank',
  
  // Moderation aliases
  '/v1/moderate': '/v1/moderations',
  '/v1/content-filter': '/v1/moderations',
  
  // Music aliases
  '/v1/music': '/v1/music/generations',
  '/v1/audiogen': '/v1/music/generations',
};

// Content type detection for media endpoints
const MEDIA_CONTENT_TYPES = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/octet-stream'],
  video: ['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp3', 'audio/flac', 'application/octet-stream'],
};

// ─── Module Interception ─────────────────────────────────────────────────────

const originalRequire = require;

/**
 * Patch the HTTP server to intercept requests and redirect endpoints
 */
function patchServer() {
  // Find the open-sse module that handles routing
  const openSsePath = originalRequire.resolve('@omniroute/open-sse');
  if (!openSsePath) {
    console.log('[endpoint-router] ⚠ open-sse module not found — skipping');
    return;
  }

  // Intercept the createServer function
  const http = originalRequire('http');
  const originalCreateServer = http.createServer;

  http.createServer = function patchedCreateServer(options, listener) {
    // If no listener passed, treat options as listener
    if (typeof options === 'function') {
      listener = options;
      options = {};
    }

    const patchedListener = function patchedListener(req, res) {
      // Check if we need to redirect the endpoint
      const originalUrl = req.url;
      let redirected = false;

      for (const [alias, target] of Object.entries(ENDPOINT_MAP)) {
        if (originalUrl.startsWith(alias)) {
          // Redirect the request
          const newPath = originalUrl.replace(alias, target);
          console.log(`[endpoint-router] Redirected: ${originalUrl} → ${newPath}`);
          req.url = newPath;
          redirected = true;
          break;
        }
      }

      // Enhance content-type detection for media endpoints
      if (!redirected && MEDIA_CONTENT_TYPES) {
        const contentType = req.headers['content-type'];
        
        if (originalUrl.includes('/v1/images/') || originalUrl.includes('/v1/videos/') || originalUrl.includes('/v1/music/')) {
          if (!contentType || contentType === 'application/octet-stream') {
            // Try to detect content type from URL or other headers
            const userAgent = req.headers['user-agent'] || '';
            if (userAgent.includes('curl') || userAgent.includes('wget')) {
              req.headers['content-type'] = 'application/json';
            }
          }
        }
      }

      // Call the original listener
      return originalListener.call(this, req, res);
    };

    return originalCreateServer.call(this, options, patchedListener);
  };

  console.log('[endpoint-router] ✅ HTTP server patched for endpoint aliases');
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  try {
    patchServer();
    console.log('[endpoint-router] 🚀 Enhanced endpoint routing active');
  } catch (e) {
    console.error('[endpoint-router] ✖ Patch failed:', e.message);
  }
}

// Apply patch when module is loaded
applyPatch();
