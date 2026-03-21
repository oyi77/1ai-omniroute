/**
 * OpenClaw OmniRoute Modular Patch: Image API Normalizer
 * ========================================================
 * Transforms all image generation requests into a unified OpenAI-compatible
 * format, handling three distinct provider API patterns:
 *
 *   Pattern A — Sync JSON      (OpenAI, Grok, Gemini native)
 *   Pattern B — Multipart      (DALL-E edits, img2img uploads)
 *   Pattern C — Async Polling  (Fal.ai, Replicate, EvoLink)
 *
 * Endpoints handled:
 *   POST /v1/images/generations   — text-to-image
 *   POST /v1/images/edits         — image-to-image / inpainting
 *   POST /v1/images/variations    — image variations
 *   GET  /api/image-normalizer/*  — monitoring & stats
 *
 * All responses are normalized to OpenAI's image response format:
 *   { created, data: [{ url, b64_json, revised_prompt }] }
 *
 * MODULAR: Loaded automatically on OmniRoute startup
 * SURVIVES UPDATES: Re-applied on each startup
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ─── Configuration ───────────────────────────────────────────────────────────

const IMAGE_NORMALIZER_CONFIG = {
  enabled: true,

  // Timeouts
  syncTimeout: 60000,          // 60s for sync providers
  asyncPollTimeout: 300000,    // 5m max for async providers
  asyncPollInterval: 2000,     // 2s between polls
  asyncPollBackoff: 1.5,       // Backoff multiplier
  asyncPollMaxInterval: 15000, // 15s max poll interval

  // Retry
  maxRetries: 2,
  retryDelay: 1000,
  retryBackoff: 2,

  // Logging
  logRequests: true,
  logDir: null, // Set dynamically below
};

// Resolve log directory
try {
  const os = require('os');
  const path = require('path');
  IMAGE_NORMALIZER_CONFIG.logDir = path.join(os.homedir(), '.omniroute', 'image-logs');
} catch (_) {}

// ─── Provider Registry ──────────────────────────────────────────────────────
// Maps provider identifiers to their API pattern and transformation logic.

const PROVIDER_REGISTRY = {

  // ── Pattern A: Sync JSON ────────────────────────────────────────────────

  'openai': {
    pattern: 'sync',
    name: 'OpenAI DALL-E',
    // Native format — no transformation needed
    transformRequest: null,
    transformResponse: null,
  },

  'grok': {
    pattern: 'sync',
    name: 'Grok Image',
    transformRequest: null,
    transformResponse: null,
  },

  'antigravity': {
    pattern: 'sync',
    name: 'Antigravity (Gemini/GPT)',
    transformRequest: null,
    transformResponse: null,
  },

  'google': {
    pattern: 'sync',
    name: 'Google Gemini Image',
    transformRequest(body) {
      // Gemini native image gen uses different format
      // Transform OpenAI format → Gemini format if needed
      if (body.prompt && !body.contents) {
        return {
          contents: [{
            parts: [{ text: body.prompt }]
          }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
            ...(body.size && { imageSize: body.size }),
          }
        };
      }
      return body;
    },
    transformResponse(data) {
      // Gemini returns candidates with inline image data
      if (data.candidates) {
        const images = [];
        for (const candidate of data.candidates) {
          if (candidate.content && candidate.content.parts) {
            for (const part of candidate.content.parts) {
              if (part.inlineData) {
                images.push({
                  b64_json: part.inlineData.data,
                  revised_prompt: null,
                });
              } else if (part.text) {
                // Some Gemini responses include text description
                if (images.length > 0) {
                  images[images.length - 1].revised_prompt = part.text;
                }
              }
            }
          }
        }
        if (images.length > 0) {
          return {
            created: Math.floor(Date.now() / 1000),
            data: images,
          };
        }
      }
      return data;
    },
  },

  // ── Pattern C: Async Polling ────────────────────────────────────────────

  'falai': {
    pattern: 'async',
    name: 'Fal.ai',
    transformRequest(body, providerConfig) {
      const baseUrl = providerConfig.baseUrl || 'https://queue.fal.run';
      const model = body.model || 'fal-ai/flux/schnell';
      // Strip provider prefix if present
      const modelId = model.replace(/^falai\//, '').replace(/^fal\//, '');

      return {
        url: `${baseUrl}/${modelId}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${providerConfig.apiKey}`,
        },
        body: {
          prompt: body.prompt,
          image_size: _parseSize(body.size),
          num_images: body.n || 1,
          ...(body.negative_prompt && { negative_prompt: body.negative_prompt }),
          ...(body.seed != null && { seed: body.seed }),
          ...(body.guidance_scale != null && { guidance_scale: body.guidance_scale }),
          ...(body.num_inference_steps != null && { num_inference_steps: body.num_inference_steps }),
          // I2I: source image for img2img / inpainting
          ...(body.image && { image_url: body.image }),
          ...(body.image_url && { image_url: body.image_url }),
          ...(body.mask && { mask_url: body.mask }),
          ...(body.strength != null && { strength: body.strength }),
        },
        // Fal.ai returns { request_id, status } for queue mode
        pollUrl: (submitResp) => {
          const reqId = submitResp.request_id;
          return `${baseUrl}/${modelId}/requests/${reqId}/status`;
        },
        resultUrl: (submitResp) => {
          const reqId = submitResp.request_id;
          return `${baseUrl}/${modelId}/requests/${reqId}`;
        },
        isComplete: (pollResp) => pollResp.status === 'COMPLETED',
        isFailed: (pollResp) => pollResp.status === 'FAILED',
        getError: (pollResp) => pollResp.error || 'Fal.ai generation failed',
      };
    },
    transformResponse(data) {
      const images = [];
      const imageList = data.images || data.output || [];
      for (const img of (Array.isArray(imageList) ? imageList : [imageList])) {
        if (typeof img === 'string') {
          images.push({ url: img });
        } else if (img && img.url) {
          images.push({ url: img.url });
        } else if (img && img.content) {
          images.push({ b64_json: img.content });
        }
      }
      return {
        created: Math.floor(Date.now() / 1000),
        data: images.length > 0 ? images : [{ url: data.url || data.image_url || '' }],
      };
    },
  },

  'replicate': {
    pattern: 'async',
    name: 'Replicate',
    transformRequest(body, providerConfig) {
      const baseUrl = providerConfig.baseUrl || 'https://api.replicate.com';
      const model = body.model || 'black-forest-labs/flux-schnell';
      const modelId = model.replace(/^replicate\//, '');

      return {
        url: `${baseUrl}/v1/predictions`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerConfig.apiKey}`,
          'Prefer': 'wait',  // Try sync first (up to 60s)
        },
        body: {
          model: modelId,
          input: {
            prompt: body.prompt,
            ...(body.negative_prompt && { negative_prompt: body.negative_prompt }),
            ...(body.size && _parseReplicateSize(body.size)),
            ...(body.n && { num_outputs: body.n }),
            ...(body.seed != null && { seed: body.seed }),
            ...(body.guidance_scale != null && { guidance_scale: body.guidance_scale }),
            // I2I: source image for img2img
            ...((body.image || body.image_url) && { image: body.image || body.image_url }),
            ...(body.mask && { mask: body.mask }),
            ...(body.strength != null && { prompt_strength: body.strength }),
          },
        },
        // Replicate returns { id, status, urls: { get } }
        pollUrl: (submitResp) => submitResp.urls && submitResp.urls.get,
        resultUrl: (submitResp) => submitResp.urls && submitResp.urls.get,
        isComplete: (pollResp) => pollResp.status === 'succeeded',
        isFailed: (pollResp) => ['failed', 'canceled'].includes(pollResp.status),
        getError: (pollResp) => pollResp.error || `Replicate prediction ${pollResp.status}`,
      };
    },
    transformResponse(data) {
      let output = data.output;
      if (!output) {
        return { created: Math.floor(Date.now() / 1000), data: [] };
      }
      if (!Array.isArray(output)) output = [output];
      return {
        created: Math.floor(Date.now() / 1000),
        data: output.map(url => (typeof url === 'string' ? { url } : { url: url.url || '' })),
      };
    },
  },

  'evolink': {
    pattern: 'async',
    name: 'EvoLink',
    transformRequest(body, providerConfig) {
      const baseUrl = providerConfig.baseUrl || 'https://api.evolink.ai';
      return {
        url: `${baseUrl}/v1/images/generations`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerConfig.apiKey}`,
        },
        body: {
          prompt: body.prompt,
          model: body.model ? body.model.replace(/^evolink\//, '') : 'default',
          ...(body.size && { size: body.size }),
          ...(body.n && { n: body.n }),
        },
        // EvoLink uses webhook-style or polling
        pollUrl: (submitResp) => {
          const taskId = submitResp.task_id || submitResp.id;
          return `${baseUrl}/v1/tasks/${taskId}`;
        },
        resultUrl: (submitResp) => {
          const taskId = submitResp.task_id || submitResp.id;
          return `${baseUrl}/v1/tasks/${taskId}`;
        },
        isComplete: (pollResp) => ['completed', 'succeeded', 'success'].includes(
          (pollResp.status || '').toLowerCase()
        ),
        isFailed: (pollResp) => ['failed', 'error'].includes(
          (pollResp.status || '').toLowerCase()
        ),
        getError: (pollResp) => pollResp.error || pollResp.message || 'EvoLink generation failed',
      };
    },
    transformResponse(data) {
      const images = data.images || data.data || data.output || [];
      const normalized = (Array.isArray(images) ? images : [images]).map(img => {
        if (typeof img === 'string') return { url: img };
        return { url: img.url || img.image_url || '' };
      });
      return {
        created: Math.floor(Date.now() / 1000),
        data: normalized,
      };
    },
  },

  'hypereal': {
    pattern: 'async',
    name: 'Hypereal AI',
    transformRequest(body, providerConfig) {
      const baseUrl = providerConfig.baseUrl || 'https://api.hypereal.tech';
      return {
        url: `${baseUrl}/v1/images/generations`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerConfig.apiKey}`,
        },
        body: {
          prompt: body.prompt,
          model: body.model ? body.model.replace(/^hypereal\//, '') : 'kling-3.0',
          ...(body.size && { size: body.size }),
          ...(body.n && { n: body.n }),
        },
        pollUrl: (submitResp) => {
          const taskId = submitResp.task_id || submitResp.id;
          return `${baseUrl}/v1/tasks/${taskId}`;
        },
        resultUrl: (submitResp) => {
          const taskId = submitResp.task_id || submitResp.id;
          return `${baseUrl}/v1/tasks/${taskId}`;
        },
        isComplete: (r) => ['completed', 'succeeded', 'success'].includes((r.status || '').toLowerCase()),
        isFailed: (r) => ['failed', 'error'].includes((r.status || '').toLowerCase()),
        getError: (r) => r.error || r.message || 'Hypereal generation failed',
      };
    },
    transformResponse(data) {
      const images = data.images || data.data || data.output || [];
      return {
        created: Math.floor(Date.now() / 1000),
        data: (Array.isArray(images) ? images : [images]).map(img =>
          typeof img === 'string' ? { url: img } : { url: img.url || '' }
        ),
      };
    },
  },

  'laozhang': {
    pattern: 'sync',
    name: 'LaoZhang AI',
    // OpenAI-compatible — no transformation needed
    transformRequest: null,
    transformResponse: null,
  },

  'pollinations': {
    pattern: 'sync',
    name: 'Pollinations',
    transformRequest: null,
    transformResponse: null,
  },

  // ── New providers: GeminiGen, Together, SiliconFlow, SegMind, NVIDIA ────

  'geminigen': {
    pattern: 'async',
    name: 'GeminiGen',
    transformRequest(body, providerConfig) {
      const baseUrl = providerConfig.baseUrl || 'https://api.geminigen.ai/uapi/v1';
      const apiKey = providerConfig.apiKey;

      // GeminiGen uses multipart/form-data
      const boundary = '----OmniRouteImg' + Date.now().toString(36);
      const parts = [];
      function addField(n, v) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}`);
      }

      addField('prompt', body.prompt || '');
      addField('model', (body.model || '').replace(/^geminigen\//, '').replace(/^gg\//, '') || 'nano-banana-pro');
      addField('style', body.style || 'Photorealistic');
      addField('output_format', 'jpeg');
      addField('resolution', '1K');

      // Aspect ratio
      const size = _parseSize(body.size);
      const ratio = size.width / size.height;
      const ar = ratio > 1.2 ? 'landscape' : ratio < 0.8 ? 'portrait' : 'square';
      addField('aspect_ratio', ar);

      parts.push(`--${boundary}--\r\n`);

      return {
        url: `${baseUrl}/generate_image`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'x-api-key': apiKey,
        },
        body: parts.join('\r\n'),
        pollUrl: (resp) => `${baseUrl}/history/${resp.uuid}`,
        resultUrl: (resp) => `${baseUrl}/history/${resp.uuid}`,
        pollHeaders: { 'x-api-key': apiKey },
        isComplete: (r) => r.status === 2,
        isFailed: (r) => r.status === 3,
        getError: (r) => r.error_message || 'GeminiGen image generation failed',
      };
    },
    transformResponse(data) {
      const images = data.generated_image || [];
      return {
        created: Math.floor(Date.now() / 1000),
        data: images.map(img => ({
          url: img.image_url || img.thumbnails?.[0]?.url || '',
        })),
      };
    },
  },

  'together': {
    pattern: 'sync',
    name: 'Together.ai',
    transformRequest(body) {
      // Together.ai is OpenAI-compatible for /v1/images/generations
      const size = _parseSize(body.size);
      return {
        model: (body.model || '').replace(/^together\//, '') || 'black-forest-labs/FLUX.1-schnell',
        prompt: body.prompt || '',
        n: body.n || 1,
        steps: body.steps || 4,
        width: size.width,
        height: size.height,
      };
    },
    transformResponse: null, // OpenAI-compatible response
  },

  'siliconflow': {
    pattern: 'sync',
    name: 'SiliconFlow',
    transformRequest(body) {
      const size = _parseSize(body.size);
      return {
        model: (body.model || '').replace(/^siliconflow\//, '').replace(/^sf\//, '') || 'black-forest-labs/FLUX.1-schnell',
        prompt: body.prompt || '',
        image_size: `${size.width}x${size.height}`,
        num_inference_steps: body.steps || 20,
        ...(body.image && { image: body.image }),
        ...(body.image_url && { image: body.image_url }),
      };
    },
    transformResponse(data) {
      // SiliconFlow returns { images: [{ url }] } or { data: [{ url }] }
      const imgs = data.images || data.data || [];
      return {
        created: Math.floor(Date.now() / 1000),
        data: (Array.isArray(imgs) ? imgs : [imgs]).map(img => {
          if (typeof img === 'string') return { url: img };
          return { url: img.url || '', ...(img.b64_json && { b64_json: img.b64_json }) };
        }),
      };
    },
  },

  'segmind': {
    pattern: 'sync',
    name: 'SegMind',
    // SegMind has multiple endpoints: flux-ipadapter, sdxl1.0-img2img
    transformRequest(body, providerConfig) {
      const baseUrl = providerConfig.baseUrl || 'https://api.segmind.com/v1';
      const rawModel = (body.model || '').replace(/^segmind\//, '');
      const size = _parseSize(body.size);

      // Determine endpoint based on mode
      let endpoint;
      const reqBody = {
        prompt: body.prompt || '',
        seed: body.seed != null ? body.seed : Math.floor(Math.random() * 2147483647),
        width: size.width,
        height: size.height,
      };

      if (body.ip_adapter_image || body.ip_adapter_image_url || rawModel.includes('ip-adapter') || rawModel.includes('ipadapter')) {
        // IP-Adapter mode (avatar consistency)
        endpoint = `${baseUrl}/flux-ipadapter`;
        reqBody.image_url = body.ip_adapter_image || body.ip_adapter_image_url || body.image || body.image_url;
        reqBody.cn_strength = body.ip_adapter_scale || body.strength || 0.7;
        reqBody.steps = body.steps || 28;
        reqBody.guidance_scale = body.guidance_scale || 3.5;
      } else if (body.image || body.image_url) {
        // I2I mode (SDXL img2img)
        endpoint = `${baseUrl}/sdxl1.0-img2img`;
        reqBody.image = body.image || body.image_url;
        reqBody.strength = body.strength || 0.75;
        reqBody.steps = body.steps || 30;
        reqBody.guidance_scale = body.guidance_scale || 7;
      } else {
        // T2I mode — use FLUX
        endpoint = `${baseUrl}/flux-schnell`;
        reqBody.steps = body.steps || 4;
      }

      return {
        _directUrl: endpoint,
        _headers: {
          'Content-Type': 'application/json',
          'x-api-key': providerConfig.apiKey,
        },
        _responseType: 'arraybuffer',
        ...reqBody,
      };
    },
    transformResponse(data) {
      // SegMind returns raw binary image
      // If we got arraybuffer, it's been converted to base64 by the handler
      if (typeof data === 'string' && data.length > 100) {
        // Likely base64 data
        return {
          created: Math.floor(Date.now() / 1000),
          data: [{ b64_json: data }],
        };
      }
      // Fallback: standard format
      if (data.data) return data;
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: data.url || '', ...(data.b64_json && { b64_json: data.b64_json }) }],
      };
    },
  },

  'nvidia': {
    pattern: 'sync',
    name: 'NVIDIA SDXL',
    transformRequest(body, providerConfig) {
      const size = _parseSize(body.size);
      return {
        _directUrl: providerConfig.baseUrl || 'https://ai.api.nvidia.com/v1/genai/stabilityai/stable-diffusion-xl',
        _headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${providerConfig.apiKey}`,
          'Accept': 'application/json',
        },
        text_prompts: [
          { text: body.prompt || '', weight: 1 },
          ...(body.negative_prompt ? [{ text: body.negative_prompt, weight: -1 }] : []),
        ],
        cfg_scale: body.guidance_scale || 7,
        height: size.height,
        width: size.width,
        samples: body.n || 1,
        steps: body.steps || 30,
        ...(body.seed != null && { seed: body.seed }),
      };
    },
    transformResponse(data) {
      // NVIDIA returns { artifacts: [{ base64 }] }
      const artifacts = data.artifacts || [];
      return {
        created: Math.floor(Date.now() / 1000),
        data: artifacts.map(a => ({ b64_json: a.base64 })),
      };
    },
  },
};

// ─── Provider Detection ──────────────────────────────────────────────────────

/**
 * Detect provider from model name or request body.
 * Model format: "provider/model-name" or just "model-name"
 */
function detectProvider(body) {
  const model = (body.model || '').toLowerCase();

  // Explicit provider prefix: "falai/flux-schnell"
  const prefixMatch = model.match(/^([a-z0-9_-]+)\//);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    // Direct match
    if (PROVIDER_REGISTRY[prefix]) return prefix;
    // Alias matching
    const aliases = {
      'fal': 'falai',
      'fal-ai': 'falai',
      'rep': 'replicate',
      'ev': 'evolink',
      'hr': 'hypereal',
      'lz': 'laozhang',
      'bp': 'byteplus',
      'dall-e': 'openai',
      'dalle': 'openai',
      'gg': 'geminigen',
      'sf': 'siliconflow',
      'seg': 'segmind',
      'nv': 'nvidia',
      'stabilityai': 'nvidia',
      'together-ai': 'together',
    };
    if (aliases[prefix]) return aliases[prefix];
  }

  // Model name heuristics
  if (/flux/i.test(model)) {
    if (model.includes('fal') || model.includes('flux/')) return 'falai';
    if (model.includes('replicate')) return 'replicate';
    if (model.includes('together')) return 'together';
    if (model.includes('silicon') || model.includes('sf')) return 'siliconflow';
    if (/schnell/i.test(model)) return 'together'; // Cheapest FLUX provider
    if (/kontext/i.test(model)) return 'laozhang'; // flux-kontext-pro for I2I
    if (/ipadapter|ip-adapter/i.test(model)) return 'segmind';
    return 'falai'; // Default FLUX
  }
  if (/sdxl|stable.?diffusion|sd3/i.test(model)) {
    if (model.includes('nvidia') || model.includes('nv')) return 'nvidia';
    if (model.includes('segmind') || model.includes('img2img')) return 'segmind';
    return 'nvidia'; // Default SDXL
  }
  if (/dall-?e|gpt.?image/i.test(model)) return 'openai';
  if (/grok/i.test(model)) return 'grok';
  if (/gemini|imagen/i.test(model)) return 'google';
  if (/nano.?banana/i.test(model)) return 'geminigen';
  if (/kling/i.test(model)) return 'hypereal';
  if (/cogview|glm|qwen.?image/i.test(model)) return 'evolink';
  if (/ipadapter|ip.?adapter/i.test(model)) return 'segmind';

  // Default: pass through to OmniRoute's native handling
  return null;
}

// ─── Size Parsing Helpers ────────────────────────────────────────────────────

function _parseSize(size) {
  if (!size) return { width: 1024, height: 1024 };
  if (typeof size === 'object') return size;
  const match = String(size).match(/(\d+)\s*x\s*(\d+)/i);
  if (match) return { width: parseInt(match[1]), height: parseInt(match[2]) };
  // Named sizes
  const named = {
    'square': { width: 1024, height: 1024 },
    'square_hd': { width: 1024, height: 1024 },
    'portrait': { width: 768, height: 1024 },
    'portrait_4_3': { width: 768, height: 1024 },
    'portrait_16_9': { width: 576, height: 1024 },
    'landscape': { width: 1024, height: 768 },
    'landscape_4_3': { width: 1024, height: 768 },
    'landscape_16_9': { width: 1024, height: 576 },
  };
  return named[size] || { width: 1024, height: 1024 };
}

function _parseReplicateSize(size) {
  const parsed = _parseSize(size);
  return { width: parsed.width, height: parsed.height };
}

// ─── HTTP Client ─────────────────────────────────────────────────────────────
// Minimal HTTP client that handles both http and https, follows redirects.

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const timeout = options.timeout || IMAGE_NORMALIZER_CONFIG.syncTimeout;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = transport.request(reqOptions, (res) => {
      // Follow redirects (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        resolve(httpRequest(redirectUrl, options));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch (_) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: parsed,
          raw: data,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out after ${timeout}ms`));
    });

    if (options.body) {
      const bodyStr = typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body);
      req.write(bodyStr);
    }

    req.end();
  });
}

// ─── Async Poll Engine ───────────────────────────────────────────────────────
// Polls an async provider until the job completes, fails, or times out.

async function pollUntilDone(config, submitResponse, providerName) {
  const pollUrl = config.pollUrl(submitResponse);
  const resultUrl = config.resultUrl(submitResponse);

  if (!pollUrl) {
    throw new Error(`[image-normalizer] ${providerName}: No poll URL returned`);
  }

  const startTime = Date.now();
  let interval = IMAGE_NORMALIZER_CONFIG.asyncPollInterval;
  let attempt = 0;

  // Use pollHeaders if specified (e.g., GeminiGen uses x-api-key instead of Authorization)
  const headers = config.pollHeaders ? { ...config.pollHeaders } : (config.headers ? { ...config.headers } : {});
  // Remove Content-Type for GET requests
  delete headers['Content-Type'];

  while (Date.now() - startTime < IMAGE_NORMALIZER_CONFIG.asyncPollTimeout) {
    attempt++;

    // Wait before polling
    await new Promise(r => setTimeout(r, interval));

    try {
      const pollResp = await httpRequest(pollUrl, {
        method: 'GET',
        headers,
        timeout: 15000,
      });

      const pollData = pollResp.data;

      if (config.isComplete(pollData)) {
        // Job done — fetch result if resultUrl differs from pollUrl
        if (resultUrl && resultUrl !== pollUrl) {
          const resultResp = await httpRequest(resultUrl, {
            method: 'GET',
            headers,
            timeout: 30000,
          });
          console.log(`[image-normalizer] ${providerName}: Completed after ${attempt} polls (${Date.now() - startTime}ms)`);
          return resultResp.data;
        }
        console.log(`[image-normalizer] ${providerName}: Completed after ${attempt} polls (${Date.now() - startTime}ms)`);
        return pollData;
      }

      if (config.isFailed(pollData)) {
        throw new Error(config.getError(pollData));
      }

      // In-progress: increase interval with backoff
      const progress = pollData.progress || pollData.percentage || null;
      if (progress != null) {
        console.log(`[image-normalizer] ${providerName}: Progress ${progress}% (poll ${attempt})`);
      }

      interval = Math.min(
        interval * IMAGE_NORMALIZER_CONFIG.asyncPollBackoff,
        IMAGE_NORMALIZER_CONFIG.asyncPollMaxInterval
      );

    } catch (err) {
      // Network errors during polling are retried (the job might still be running)
      if (err.message.includes('timed out') || err.code === 'ECONNRESET') {
        console.warn(`[image-normalizer] ${providerName}: Poll ${attempt} network error, retrying...`);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`[image-normalizer] ${providerName}: Timed out after ${IMAGE_NORMALIZER_CONFIG.asyncPollTimeout / 1000}s`);
}

// ─── Request Processor ──────────────────────────────────────────────────────
// Core logic: detects provider, transforms request, routes, normalizes response.

async function processImageRequest(requestBody, endpoint, providerConfigOverrides) {
  const provider = detectProvider(requestBody);

  // No recognized provider → let OmniRoute handle it natively
  if (!provider) {
    return null; // Signal: pass through to OmniRoute
  }

  const registry = PROVIDER_REGISTRY[provider];
  if (!registry) {
    return null; // Unknown provider, pass through
  }

  const providerConfig = {
    apiKey: providerConfigOverrides.apiKey || '',
    baseUrl: providerConfigOverrides.baseUrl || '',
    ...providerConfigOverrides,
  };

  console.log(`[image-normalizer] Routing to ${registry.name} (pattern: ${registry.pattern})`);

  // Track timing
  const startTime = Date.now();

  try {
    if (registry.pattern === 'sync') {
      return await handleSyncProvider(requestBody, registry, providerConfig, endpoint);
    } else if (registry.pattern === 'async') {
      return await handleAsyncProvider(requestBody, registry, providerConfig, endpoint);
    }
  } finally {
    const duration = Date.now() - startTime;
    recordStats(provider, registry.pattern, duration, true);
  }

  return null;
}

// ─── Sync Provider Handler ───────────────────────────────────────────────────

async function handleSyncProvider(body, registry, providerConfig, _endpoint) {
  // Transform request if provider needs it
  let transformedBody = body;
  if (registry.transformRequest) {
    transformedBody = registry.transformRequest(body, providerConfig);
  }

  // For sync providers that are OpenAI-compatible, just return null
  // to let OmniRoute handle them natively (it already knows how)
  if (!registry.transformRequest && !registry.transformResponse) {
    return null; // OmniRoute native handling
  }

  // Providers with _directUrl specify their own endpoint (SegMind, NVIDIA, Together)
  if (transformedBody && transformedBody._directUrl) {
    const directUrl = transformedBody._directUrl;
    const directHeaders = transformedBody._headers || {};
    const isArrayBuffer = transformedBody._responseType === 'arraybuffer';

    // Remove meta fields from body before sending
    const cleanBody = { ...transformedBody };
    delete cleanBody._directUrl;
    delete cleanBody._headers;
    delete cleanBody._responseType;

    const resp = await httpRequest(directUrl, {
      method: 'POST',
      headers: directHeaders,
      body: cleanBody,
      timeout: IMAGE_NORMALIZER_CONFIG.syncTimeout,
    });

    if (resp.status >= 400) {
      throw new Error(`${registry.name} returned ${resp.status}: ${resp.raw}`);
    }

    // If binary response (SegMind), convert to base64
    if (isArrayBuffer && typeof resp.data === 'string' && !resp.data.startsWith('{')) {
      const b64 = Buffer.from(resp.raw, 'binary').toString('base64');
      if (registry.transformResponse) {
        return registry.transformResponse(b64);
      }
      return { created: Math.floor(Date.now() / 1000), data: [{ b64_json: b64 }] };
    }

    if (registry.transformResponse) {
      return registry.transformResponse(resp.data);
    }
    return resp.data;
  }

  // For providers with custom formats (e.g., Gemini), make the request ourselves
  if (providerConfig.baseUrl && registry.transformRequest) {
    const url = `${providerConfig.baseUrl}${_endpoint}`;
    const resp = await httpRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(providerConfig.apiKey && {
          'Authorization': `Bearer ${providerConfig.apiKey}`,
        }),
      },
      body: transformedBody,
      timeout: IMAGE_NORMALIZER_CONFIG.syncTimeout,
    });

    if (resp.status >= 400) {
      throw new Error(`${registry.name} returned ${resp.status}: ${resp.raw}`);
    }

    if (registry.transformResponse) {
      return registry.transformResponse(resp.data);
    }
    return resp.data;
  }

  return null;
}

// ─── Async Provider Handler ──────────────────────────────────────────────────

async function handleAsyncProvider(body, registry, providerConfig, endpoint) {
  if (!registry.transformRequest) {
    throw new Error(`Async provider ${registry.name} has no transformRequest defined`);
  }

  const reqConfig = registry.transformRequest(body, providerConfig);

  // Step 1: Submit the job
  console.log(`[image-normalizer] ${registry.name}: Submitting async job to ${reqConfig.url}`);

  const submitResp = await httpRequest(reqConfig.url, {
    method: reqConfig.method || 'POST',
    headers: reqConfig.headers,
    body: reqConfig.body,
    timeout: IMAGE_NORMALIZER_CONFIG.syncTimeout,
  });

  if (submitResp.status >= 400) {
    throw new Error(`${registry.name} submit failed (${submitResp.status}): ${submitResp.raw}`);
  }

  const submitData = submitResp.data;

  // Check if the provider returned a synchronous result (e.g., Replicate with Prefer: wait)
  if (reqConfig.isComplete && reqConfig.isComplete(submitData)) {
    console.log(`[image-normalizer] ${registry.name}: Got synchronous result`);
    if (registry.transformResponse) {
      return registry.transformResponse(submitData);
    }
    return submitData;
  }

  // Step 2: Poll until complete
  const result = await pollUntilDone(reqConfig, submitData, registry.name);

  // Step 3: Transform response
  if (registry.transformResponse) {
    return registry.transformResponse(result);
  }
  return result;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  byProvider: {},
  byPattern: { sync: 0, async: 0, passthrough: 0 },
  avgResponseTime: 0,
  lastRequest: null,
  startedAt: new Date().toISOString(),
};

function recordStats(provider, pattern, duration, success) {
  stats.totalRequests++;
  if (success) {
    stats.successfulRequests++;
  } else {
    stats.failedRequests++;
  }
  stats.byPattern[pattern] = (stats.byPattern[pattern] || 0) + 1;
  stats.lastRequest = new Date().toISOString();

  if (!stats.byProvider[provider]) {
    stats.byProvider[provider] = {
      requests: 0, success: 0, failed: 0, avgTime: 0, lastUsed: null,
    };
  }
  const ps = stats.byProvider[provider];
  ps.requests++;
  if (success) ps.success++;
  else ps.failed++;
  ps.avgTime = (ps.avgTime * (ps.requests - 1) + duration) / ps.requests;
  ps.lastUsed = new Date().toISOString();

  stats.avgResponseTime =
    (stats.avgResponseTime * (stats.totalRequests - 1) + duration) / stats.totalRequests;
}

function getStats() {
  return {
    ...stats,
    successRate: stats.totalRequests > 0
      ? (stats.successfulRequests / stats.totalRequests * 100).toFixed(2) + '%'
      : '0%',
    avgResponseTimeMs: Math.round(stats.avgResponseTime) + 'ms',
    registeredProviders: Object.keys(PROVIDER_REGISTRY).length,
    providerDetails: Object.entries(PROVIDER_REGISTRY).map(([id, r]) => ({
      id,
      name: r.name,
      pattern: r.pattern,
    })),
  };
}

// ─── Request Body Parser ─────────────────────────────────────────────────────
// Collects the full request body from a Node.js IncomingMessage stream.

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const maxSize = 50 * 1024 * 1024; // 50MB limit for image uploads

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Request body too large (max 50MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        // Not JSON — might be multipart. Return raw.
        resolve({ _raw: raw, _contentType: req.headers['content-type'] });
      }
    });

    req.on('error', reject);
  });
}

// ─── Multipart Handler ───────────────────────────────────────────────────────
// For /v1/images/edits and /v1/images/variations which accept form-data

function isMultipart(req) {
  return (req.headers['content-type'] || '').includes('multipart/form-data');
}

// Note: Multipart requests (image edits with form-data uploads) are passed
// through to OmniRoute's native handler. The isMultipart() check in the
// server patch ensures we don't consume multipart streams.

// ─── HTTP Server Patch ───────────────────────────────────────────────────────

function patchHttpServer() {
  try {
    const httpMod = require('http');
    const originalCreateServer = httpMod.createServer;

    httpMod.createServer = function patchedCreateServer(options, listener) {
      if (typeof options === 'function') {
        listener = options;
        options = {};
      }

      const patchedListener = function imageNormalizerListener(req, res) {

        // ── Monitoring API endpoints ──

        if (req.url === '/api/image-normalizer/stats' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(getStats(), null, 2));
          return;
        }

        if (req.url === '/api/image-normalizer/providers' && req.method === 'GET') {
          const providers = Object.entries(PROVIDER_REGISTRY).map(([id, r]) => ({
            id,
            name: r.name,
            pattern: r.pattern,
            hasRequestTransform: !!r.transformRequest,
            hasResponseTransform: !!r.transformResponse,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ providers, total: providers.length }, null, 2));
          return;
        }

        if (req.url === '/api/image-normalizer/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'healthy',
            uptime: Date.now() - new Date(stats.startedAt).getTime(),
            totalProcessed: stats.totalRequests,
            successRate: stats.totalRequests > 0
              ? (stats.successfulRequests / stats.totalRequests * 100).toFixed(2) + '%'
              : 'N/A',
          }));
          return;
        }

        // ── Image generation endpoints ──

        const isImageGen = req.method === 'POST' && (
          req.url === '/v1/images/generations' ||
          req.url === '/v1/images/edits' ||
          req.url === '/v1/images/variations'
        );

        if (isImageGen && !isMultipart(req)) {
          // Intercept the request: collect body, process, respond
          collectBody(req).then(async (body) => {
            const endpoint = req.url;

            // Extract auth from request headers (OmniRoute may forward provider API key)
            const authHeader = req.headers['authorization'] || '';
            const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim();

            // Try to get provider config from body or headers
            const providerConfigOverrides = {
              apiKey: body._providerApiKey || apiKey,
              baseUrl: body._providerBaseUrl || '',
            };

            try {
              const result = await processImageRequest(
                body, endpoint, providerConfigOverrides
              );

              if (result === null) {
                // Pass through to OmniRoute native handler
                // We need to re-create the request body since we consumed it
                _replayRequest(req, res, body, listener);
                stats.byPattern.passthrough = (stats.byPattern.passthrough || 0) + 1;
                return;
              }

              // Validate response format
              const normalized = _ensureOpenAIFormat(result);

              res.writeHead(200, {
                'Content-Type': 'application/json',
                'X-Image-Normalizer': 'true',
                'X-Provider': detectProvider(body) || 'unknown',
              });
              res.end(JSON.stringify(normalized));

            } catch (err) {
              console.error(`[image-normalizer] Error: ${err.message}`);
              const provider = detectProvider(body);
              recordStats(provider || 'unknown', 'error', 0, false);

              const statusCode = _errorToStatusCode(err);
              res.writeHead(statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: {
                  message: err.message,
                  type: 'image_normalizer_error',
                  provider: provider || 'unknown',
                  code: statusCode,
                },
              }));
            }
          }).catch((err) => {
            console.error(`[image-normalizer] Body parse error: ${err.message}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: {
                message: 'Failed to parse request body: ' + err.message,
                type: 'invalid_request_error',
              },
            }));
          });
          return;
        }

        // ── Not an image request — pass through ──
        return listener.call(this, req, res);
      };

      return originalCreateServer.call(this, options, patchedListener);
    };

    console.log('[image-normalizer] ✅ HTTP server patched for image API normalization');
  } catch (e) {
    console.error('[image-normalizer] ✖ Failed to patch HTTP server:', e.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ensure response conforms to OpenAI image response format.
 */
function _ensureOpenAIFormat(data) {
  // Already in correct format
  if (data && data.data && Array.isArray(data.data) && data.created) {
    return data;
  }

  // Wrap if needed
  const images = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      images.push(_normalizeImageItem(item));
    }
  } else if (data && typeof data === 'object') {
    // Single image object
    if (data.url || data.b64_json) {
      images.push(_normalizeImageItem(data));
    }
    // Response with nested data
    else if (data.data) {
      const items = Array.isArray(data.data) ? data.data : [data.data];
      for (const item of items) {
        images.push(_normalizeImageItem(item));
      }
    }
    // Response with output/images
    else if (data.output || data.images) {
      const items = data.output || data.images;
      for (const item of (Array.isArray(items) ? items : [items])) {
        images.push(_normalizeImageItem(item));
      }
    }
  }

  return {
    created: data.created || Math.floor(Date.now() / 1000),
    data: images,
  };
}

function _normalizeImageItem(item) {
  if (typeof item === 'string') {
    // Could be URL or base64
    if (item.startsWith('http://') || item.startsWith('https://')) {
      return { url: item };
    }
    return { b64_json: item };
  }
  if (item && typeof item === 'object') {
    return {
      ...(item.url && { url: item.url }),
      ...(item.b64_json && { b64_json: item.b64_json }),
      ...(item.revised_prompt && { revised_prompt: item.revised_prompt }),
    };
  }
  return { url: '' };
}

/**
 * Replay a consumed request body back into OmniRoute's native handler.
 * Since we already read the body stream, we need to simulate it.
 */
function _replayRequest(req, res, body, listener) {
  const bodyStr = JSON.stringify(body);

  // Override the request to re-emit the body
  const { Readable } = require('stream');
  const fakeStream = new Readable({
    read() {
      this.push(bodyStr);
      this.push(null);
    }
  });

  // Copy properties from original request
  fakeStream.method = req.method;
  fakeStream.url = req.url;
  fakeStream.headers = {
    ...req.headers,
    'content-length': Buffer.byteLength(bodyStr).toString(),
    'content-type': 'application/json',
  };
  fakeStream.httpVersion = req.httpVersion;
  fakeStream.socket = req.socket;
  fakeStream.connection = req.connection;

  // Forward standard request properties
  Object.defineProperty(fakeStream, 'complete', { get: () => true });

  return listener.call(this, fakeStream, res);
}

/**
 * Map error messages to appropriate HTTP status codes.
 */
function _errorToStatusCode(err) {
  const msg = err.message || '';
  if (msg.includes('timed out') || msg.includes('Timed out')) return 504;
  if (msg.includes('401') || msg.includes('unauthorized')) return 401;
  if (msg.includes('403') || msg.includes('forbidden')) return 403;
  if (msg.includes('429') || msg.includes('rate limit')) return 429;
  if (msg.includes('404') || msg.includes('not found')) return 404;
  if (msg.includes('too large')) return 413;
  if (msg.includes('submit failed')) return 502;
  return 500;
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  if (!IMAGE_NORMALIZER_CONFIG.enabled) {
    console.log('[image-normalizer] ⚠️ Patch disabled by config');
    return;
  }

  patchHttpServer();

  // Create log directory
  if (IMAGE_NORMALIZER_CONFIG.logDir) {
    try {
      const fs = require('fs');
      fs.mkdirSync(IMAGE_NORMALIZER_CONFIG.logDir, { recursive: true });
    } catch (_) {}
  }

  // Expose globally for other patches to use
  global.imageNormalizer = {
    processImageRequest,
    detectProvider,
    getStats,
    PROVIDER_REGISTRY,
  };

  const providerCount = Object.keys(PROVIDER_REGISTRY).length;
  const asyncCount = Object.values(PROVIDER_REGISTRY).filter(p => p.pattern === 'async').length;
  const syncCount = providerCount - asyncCount;

  console.log('[image-normalizer] 🚀 Image API normalization active');
  console.log(`[image-normalizer] 📊 ${providerCount} providers registered (${syncCount} sync, ${asyncCount} async)`);
  console.log('[image-normalizer] 📊 Endpoints:');
  console.log('  - POST /v1/images/generations  (text-to-image)');
  console.log('  - POST /v1/images/edits         (image-to-image)');
  console.log('  - POST /v1/images/variations    (variations)');
  console.log('  - GET  /api/image-normalizer/stats');
  console.log('  - GET  /api/image-normalizer/providers');
  console.log('  - GET  /api/image-normalizer/health');
}

applyPatch();
