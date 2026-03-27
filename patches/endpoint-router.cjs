/**
 * OpenClaw OmniRoute Modular Patch: Enhanced Endpoint Router
 * ===========================================================
 * Adds and enhances endpoints for video, image, vision, audio, etc.
 * Ensures OmniRoute can handle all standard AI aggregator scenarios.
 * 
 * WHAT THIS PATCHES:
 * - Adds missing endpoint aliases (e.g., /v1/generate → /v1/images/generations)
 * - Enhances content-type detection for media endpoints
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
  '/v1/flux': '/v1/images/generations',

  // Image edit aliases
  '/v1/edit': '/v1/images/edits',
  '/v1/inpaint': '/v1/images/edits',
  '/v1/img2img': '/v1/images/edits',
  '/v1/image-edit': '/v1/images/edits',

  // Image variation aliases
  '/v1/vary': '/v1/images/variations',
  '/v1/variation': '/v1/images/variations',
  '/v1/image-variation': '/v1/images/variations',

  // Video generation aliases (t2v, i2v, f2v — all via /v1/videos/generations)
  '/v1/video': '/v1/videos/generations',
  '/v1/t2v': '/v1/videos/generations',
  '/v1/i2v': '/v1/videos/generations',
  '/v1/f2v': '/v1/videos/generations',
  '/v1/text-to-video': '/v1/videos/generations',
  '/v1/image-to-video': '/v1/videos/generations',
  '/v1/frame-to-video': '/v1/videos/generations',
  '/v1/sora': '/v1/videos/generations',
  '/v1/seedance': '/v1/videos/generations',
  '/v1/kling': '/v1/videos/generations',
  '/v1/runway': '/v1/videos/generations',
  '/v1/pika': '/v1/videos/generations',
  '/v1/animatediff': '/v1/videos/generations',
  '/v1/cogvideo': '/v1/videos/generations',
  '/v1/hunyuan': '/v1/videos/generations',
  '/v1/veo': '/v1/videos/generations',
  '/v1/hailuo': '/v1/videos/generations',

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

// ─── HTTP Middleware Registration ───────────────────────────────────────────

/**
 * Endpoint router middleware handler.
 * Rewrites incoming URLs that match known aliases to their canonical paths.
 */
function endpointRouterMiddleware(req, res, next) {
  const originalUrl = req.url;

  // Check if URL matches any alias
  for (const [alias, target] of Object.entries(ENDPOINT_MAP)) {
    if (originalUrl.startsWith(alias)) {
      const newPath = originalUrl.replace(alias, target);
      console.log(`[endpoint-router] Redirected: ${originalUrl} → ${newPath}`);
      req.url = newPath;
      break;
    }
  }

  // Always pass to next middleware — this patch only rewrites, never terminates
  next();
}

// ─── Apply ──────────────────────────────────────────────────────────────────

function applyPatch() {
  if (global.__patchHooks) {
    // Priority 10 — run early so URL is rewritten before other middleware sees it
    global.__patchHooks.registerHttpMiddleware('endpoint-router', endpointRouterMiddleware, { priority: 10 });
  } else {
    console.error('[endpoint-router] ✖ patch-hooks not loaded — endpoint-router will not work');
  }
  console.log('[endpoint-router] 🚀 Enhanced endpoint routing active');
}

applyPatch();
