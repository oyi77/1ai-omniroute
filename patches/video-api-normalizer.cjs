/**
 * OpenClaw OmniRoute Modular Patch: Video API Normalizer
 * ========================================================
 * Transforms all video generation requests into a unified format,
 * supporting three generation modes:
 *
 *   T2V — text-to-video     (prompt only)
 *   I2V — image-to-video    (prompt + image/image_url)
 *   F2V — first-frame-video (prompt + first_frame + optional last_frame)
 *
 * Provider API patterns handled:
 *   Pattern A — Async Task-Based  (BytePlus, EvoLink, Hypereal, Kie.ai)
 *   Pattern B — Queue-Based       (Fal.ai, Replicate)
 *   Pattern C — Chat Completion   (LaoZhang — sync, returns URL in message)
 *
 * Endpoints:
 *   POST /v1/videos/generations   — t2v, i2v, f2v (auto-detected)
 *   GET  /api/video-normalizer/*  — monitoring & stats
 *
 * Unified request format:
 *   {
 *     model, prompt,
 *     duration, size, fps,            // optional
 *     image, image_url,               // for i2v
 *     first_frame, last_frame,        // for f2v
 *     negative_prompt, seed,          // optional
 *     aspect_ratio, quality, webhook_url
 *   }
 *
 * Normalized response:
 *   { created, data: [{ url, revised_prompt, duration, width, height }] }
 *
 * MODULAR: Loaded automatically on OmniRoute startup
 * SURVIVES UPDATES: Re-applied on each startup
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ─── Configuration ───────────────────────────────────────────────────────────

const VIDEO_NORMALIZER_CONFIG = {
  enabled: true,

  // Timeouts — video generation is slow
  submitTimeout: 30000,         // 30s to submit job
  pollTimeout: 600000,          // 10m max for async providers
  pollInterval: 5000,           // 5s between polls
  pollBackoff: 1.3,             // Gentle backoff
  pollMaxInterval: 20000,       // 20s max poll interval
  syncTimeout: 300000,          // 5m for sync providers (LaoZhang Sora)

  // Retry
  maxRetries: 2,
  retryDelay: 2000,
  retryBackoff: 2,

  logRequests: true,
};

// ─── Mode Detection ──────────────────────────────────────────────────────────

/**
 * Detect generation mode from request body.
 *   f2v — explicit first_frame field
 *   i2v — image or image_url field
 *   t2v — prompt only (default)
 */
function detectMode(body) {
  if (body.first_frame) return 'f2v';
  if (body.image || body.image_url) return 'i2v';
  return 't2v';
}

// ─── Size / Aspect Ratio Helpers ─────────────────────────────────────────────

function parseSize(size) {
  if (!size) return { width: 1280, height: 720 };
  if (typeof size === 'object' && size.width) return size;
  const match = String(size).match(/(\d+)\s*x\s*(\d+)/i);
  if (match) return { width: parseInt(match[1]), height: parseInt(match[2]) };
  const named = {
    '1080p': { width: 1920, height: 1080 },
    '720p': { width: 1280, height: 720 },
    '480p': { width: 854, height: 480 },
    'portrait': { width: 720, height: 1280 },
    'landscape': { width: 1280, height: 720 },
    'square': { width: 720, height: 720 },
  };
  return named[size] || { width: 1280, height: 720 };
}

function sizeToAspectRatio(size) {
  const { width, height } = parseSize(size);
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
  if (Math.abs(ratio - 4 / 3) < 0.1) return '4:3';
  if (Math.abs(ratio - 3 / 4) < 0.1) return '3:4';
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  return '16:9';
}

// aspectRatioToSize available for future use by provider transforms
// function aspectRatioToSize(ratio) { ... }

// ─── HTTP Client ─────────────────────────────────────────────────────────────

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === 'https:' ? https : http;
    const timeout = options.timeout || VIDEO_NORMALIZER_CONFIG.submitTimeout;

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = transport.request(reqOptions, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        resolve(httpRequest(new URL(res.headers.location, url).toString(), options));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: parsed, raw: data });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy();
      reject(new Error(`Request to ${parsedUrl.hostname} timed out after ${timeout}ms`));
    });

    if (options.body) {
      const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
      if (!options.headers['content-length'] && !options.headers['Content-Length']) {
        req.setHeader('Content-Length', Buffer.byteLength(bodyStr));
      }
      req.write(bodyStr);
    }

    req.end();
  });
}

// ─── Async Poll Engine ───────────────────────────────────────────────────────

async function pollUntilDone(pollFn, providerName) {
  const startTime = Date.now();
  let interval = VIDEO_NORMALIZER_CONFIG.pollInterval;
  let attempt = 0;

  while (Date.now() - startTime < VIDEO_NORMALIZER_CONFIG.pollTimeout) {
    attempt++;
    await new Promise(r => setTimeout(r, interval));

    try {
      const result = await pollFn(attempt);

      if (result.done) {
        console.log(`[video-normalizer] ${providerName}: Completed after ${attempt} polls (${Math.round((Date.now() - startTime) / 1000)}s)`);
        return result.data;
      }

      if (result.failed) {
        throw new Error(result.error || `${providerName} generation failed`);
      }

      if (result.progress != null) {
        console.log(`[video-normalizer] ${providerName}: Progress ${result.progress} (poll ${attempt})`);
      }

    } catch (err) {
      // Network errors during polling — job might still be running
      if (err.message.includes('timed out') || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
        console.warn(`[video-normalizer] ${providerName}: Poll ${attempt} network error, retrying...`);
        // Don't count network errors towards backoff
        continue;
      }
      throw err;
    }

    interval = Math.min(interval * VIDEO_NORMALIZER_CONFIG.pollBackoff, VIDEO_NORMALIZER_CONFIG.pollMaxInterval);
  }

  throw new Error(`[video-normalizer] ${providerName}: Timed out after ${VIDEO_NORMALIZER_CONFIG.pollTimeout / 1000}s`);
}

// ─── Provider Registry ──────────────────────────────────────────────────────

const VIDEO_PROVIDERS = {

  // ══════════════════════════════════════════════════════════════════════════
  // Pattern A: Async Task-Based
  // ══════════════════════════════════════════════════════════════════════════

  'byteplus': {
    name: 'BytePlus Seedance',
    pattern: 'async-task',
    modes: ['t2v', 'i2v', 'f2v'],
    defaultModel: 'seedance-1-5-pro-251215',

    models: {
      'seedance-lite': 'seedance-1-0-lite-t2v-250428',
      'seedance-pro-fast': 'seedance-1-0-pro-fast-251015',
      'seedance-pro': 'seedance-1-0-pro-250528',
      'seedance-1.5': 'seedance-1-5-pro-251215',
      'seedance-1.5-pro': 'seedance-1-5-pro-251215',
    },

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://ark.ap-southeast.bytepluses.com/api/v3';
      const modelRaw = (body.model || '').replace(/^byteplus\//, '').replace(/^bp\//, '');
      const model = this.models[modelRaw] || modelRaw || this.defaultModel;

      // Build content array
      const content = [{ type: 'text', text: body.prompt || '' }];

      // I2V / F2V: add image as first_frame
      const imageUrl = body.first_frame || body.image_url || body.image;
      if ((mode === 'i2v' || mode === 'f2v') && imageUrl) {
        content.push({
          type: 'image_url',
          image_url: { url: imageUrl },
          role: 'first_frame',
        });
      }

      const reqBody = {
        model,
        content,
        ...(body.aspect_ratio && { ratio: body.aspect_ratio }),
        ...(!body.aspect_ratio && body.size && { ratio: sizeToAspectRatio(body.size) }),
        ...(body.duration && { duration: body.duration }),
        ...(body.seed != null && { seed: body.seed }),
      };

      const resp = await httpRequest(`${baseUrl}/contents/generations/tasks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: reqBody,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400) {
        const errMsg = resp.data?.error?.message || resp.raw;
        throw new Error(`BytePlus submit failed (${resp.status}): ${errMsg}`);
      }

      const taskId = resp.data.id || resp.data.task_id;
      if (!taskId) throw new Error('BytePlus: No task ID returned');

      return { taskId, baseUrl, apiKey: config.apiKey };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(
          `${ctx.baseUrl}/contents/generations/tasks/${ctx.taskId}`,
          {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
            timeout: 15000,
          }
        );

        const d = resp.data;
        const status = (d.status || '').toLowerCase();

        if (status === 'succeeded') {
          return {
            done: true,
            data: {
              video_url: d.content?.video_url,
              duration: d.duration,
              resolution: d.resolution,
              revised_prompt: d.revised_prompt,
              seed: d.seed,
              last_frame_url: d.content?.last_frame_url,
            },
          };
        }

        if (['failed', 'cancelled'].includes(status)) {
          return { failed: true, error: d.error?.message || `Task ${status}` };
        }

        return { done: false, progress: d.progress || status };
      };
    },

    normalize(result) {
      const dims = _parseResolution(result.resolution);
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{
          url: result.video_url,
          revised_prompt: result.revised_prompt || null,
          duration: result.duration || null,
          width: dims.width,
          height: dims.height,
          seed: result.seed || null,
        }],
      };
    },
  },

  'evolink': {
    name: 'EvoLink',
    pattern: 'async-task',
    modes: ['t2v', 'i2v'],
    defaultModel: 'wan2.5-text-to-video',

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://api.evolink.ai';
      const model = (body.model || '').replace(/^evolink\//, '').replace(/^ev\//, '') || this.defaultModel;

      const reqBody = {
        model,
        prompt: body.prompt || '',
        ...(body.aspect_ratio && { aspect_ratio: body.aspect_ratio }),
        ...(!body.aspect_ratio && body.size && { aspect_ratio: sizeToAspectRatio(body.size) }),
        ...(body.webhook_url && { webhook_url: body.webhook_url }),
      };

      // I2V: add image
      if (mode === 'i2v' || mode === 'f2v') {
        reqBody.image_url = body.image_url || body.image || body.first_frame;
      }

      const resp = await httpRequest(`${baseUrl}/v1/videos/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: reqBody,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400) {
        const errMsg = resp.data?.error?.message || resp.raw;
        throw new Error(`EvoLink submit failed (${resp.status}): ${errMsg}`);
      }

      const taskId = resp.data.id || resp.data.task_id;
      if (!taskId) throw new Error('EvoLink: No task ID returned');

      return { taskId, baseUrl, apiKey: config.apiKey };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(`${ctx.baseUrl}/v1/tasks/${ctx.taskId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
          timeout: 15000,
        });

        const d = resp.data;
        const status = (d.status || '').toLowerCase();

        if (status === 'completed') {
          // EvoLink puts URL in multiple places
          const videoUrl = d.results?.[0]?.url || d.output?.url || d.video_url;
          return { done: true, data: { video_url: videoUrl } };
        }

        if (['failed', 'error'].includes(status)) {
          return { failed: true, error: d.error?.message || d.message || 'EvoLink failed' };
        }

        return { done: false, progress: status };
      };
    },

    normalize(result) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: result.video_url }],
      };
    },
  },

  'hypereal': {
    name: 'Hypereal AI',
    pattern: 'async-task',
    modes: ['t2v', 'i2v'],
    defaultModel: 'kling-3-0-std-t2v',

    _resolveModel(rawModel, mode) {
      // Auto-select t2v vs i2v model variant
      const model = rawModel.replace(/^hypereal\//, '').replace(/^hr\//, '');
      if (!model) {
        return mode === 'i2v' ? 'kling-3-0-std-i2v' : 'kling-3-0-std-t2v';
      }
      // If user specified a base model without mode suffix, append it
      if (!model.includes('-t2v') && !model.includes('-i2v')) {
        return mode === 'i2v' ? `${model}-i2v` : `${model}-t2v`;
      }
      return model;
    },

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://api.hypereal.tech';
      const model = this._resolveModel(body.model || '', mode);

      const input = {
        prompt: body.prompt || '',
        ...(body.duration && { duration: body.duration }),
      };

      // I2V / F2V: add image
      if (mode === 'i2v' || mode === 'f2v') {
        input.image = body.image_url || body.image || body.first_frame;
      }

      const reqBody = {
        model,
        input,
        ...(body.webhook_url && { webhook_url: body.webhook_url }),
      };

      const resp = await httpRequest(`${baseUrl}/v1/videos/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: reqBody,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400) {
        throw new Error(`Hypereal submit failed (${resp.status}): ${resp.raw}`);
      }

      const jobId = resp.data.jobId || resp.data.job_id || resp.data.id;
      if (!jobId) throw new Error('Hypereal: No job ID returned');

      return { jobId, baseUrl, apiKey: config.apiKey, model };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(
          `${ctx.baseUrl}/v1/jobs/${ctx.jobId}?model=${encodeURIComponent(ctx.model)}&type=video`,
          {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
            timeout: 15000,
          }
        );

        const d = resp.data;
        const status = (d.status || '').toLowerCase();

        if (status === 'completed') {
          return {
            done: true,
            data: { video_url: d.outputUrl || d.output_url },
          };
        }

        if (status === 'failed') {
          return { failed: true, error: d.error || 'Hypereal job failed' };
        }

        return { done: false, progress: status };
      };
    },

    normalize(result) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: result.video_url }],
      };
    },
  },

  'kie': {
    name: 'Kie.ai',
    pattern: 'async-task',
    modes: ['t2v', 'i2v'],
    defaultModel: 'runway',

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://api.kie.ai';

      const reqBody = {
        prompt: body.prompt || '',
        duration: body.duration || 5,
        quality: body.quality || '720p',
        aspectRatio: body.aspect_ratio || sizeToAspectRatio(body.size),
        waterMark: body.watermark || 'none',
      };

      // I2V: add image
      if (mode === 'i2v' || mode === 'f2v') {
        reqBody.imageUrl = body.image_url || body.image || body.first_frame;
      }

      const resp = await httpRequest(`${baseUrl}/api/v1/runway/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: reqBody,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400 || resp.data?.code !== 200) {
        const errMsg = resp.data?.msg || resp.raw;
        throw new Error(`Kie.ai submit failed: ${errMsg}`);
      }

      const taskId = resp.data?.data?.taskId;
      if (!taskId) throw new Error('Kie.ai: No task ID returned');

      return { taskId, baseUrl, apiKey: config.apiKey };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(
          `${ctx.baseUrl}/api/v1/runway/record-detail?taskId=${ctx.taskId}`,
          {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
            timeout: 15000,
          }
        );

        const d = resp.data;

        if (d.code !== 200 && d.msg) {
          // API error (not task failure)
          return { done: false, progress: 'waiting' };
        }

        const status = (d.data?.state || d.data?.status || '').toLowerCase();

        if (['success', 'completed'].includes(status)) {
          const videoUrl = d.data?.videoInfo?.videoUrl || d.data?.videoUrl || d.data?.video_url;
          return { done: true, data: { video_url: videoUrl } };
        }

        if (['failed', 'error', 'fail'].includes(status)) {
          return { failed: true, error: d.data?.msg || 'Kie.ai generation failed' };
        }

        return { done: false, progress: status || 'processing' };
      };
    },

    normalize(result) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: result.video_url }],
      };
    },
  },

  'geminigen': {
    name: 'GeminiGen',
    pattern: 'async-task',
    modes: ['t2v', 'i2v'],
    defaultModel: 'grok-3',

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://api.geminigen.ai/uapi/v1';
      const model = (body.model || '').replace(/^geminigen\//, '') || this.defaultModel;
      const apiKey = config.apiKey;

      // GeminiGen uses multipart/form-data
      const boundary = '----OmniRoute' + Date.now().toString(36);
      const parts = [];

      function addField(name, value) {
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}`);
      }

      addField('prompt', body.prompt || '');
      addField('model', model);

      // Duration: snap to nearest 5/6/10/15
      const dur = body.duration || 5;
      const snapped = dur <= 5 ? '5' : dur <= 8 ? '6' : dur <= 12 ? '10' : '15';
      addField('duration', snapped);

      // Aspect ratio
      const ar = body.aspect_ratio || sizeToAspectRatio(body.size);
      const arMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square', '4:3': 'landscape', '3:4': 'portrait' };
      addField('aspect_ratio', arMap[ar] || 'landscape');

      // I2V: reference image as file upload
      if (mode === 'i2v' || mode === 'f2v') {
        const imgUrl = body.image_url || body.image || body.first_frame;
        if (imgUrl) {
          // If base64 data URL, extract binary
          const b64Match = imgUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (b64Match) {
            // Send base64 image as data URL in a form field
            addField('ref_image_url', imgUrl);
          } else {
            // URL reference — GeminiGen expects file upload, add as field
            addField('ref_image_url', imgUrl);
          }
        }
      }

      parts.push(`--${boundary}--\r\n`);
      const formBody = parts.join('\r\n');

      const resp = await httpRequest(`${baseUrl}/video-gen/grok`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'x-api-key': apiKey,
        },
        body: formBody,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400) {
        throw new Error(`GeminiGen submit failed (${resp.status}): ${resp.raw}`);
      }

      const uuid = resp.data?.uuid;
      if (!uuid) throw new Error('GeminiGen: No UUID returned');

      return { uuid, baseUrl, apiKey };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(`${ctx.baseUrl}/history/${ctx.uuid}`, {
          method: 'GET',
          headers: { 'x-api-key': ctx.apiKey },
          timeout: 15000,
        });

        const d = resp.data;

        if (d.status === 2) {
          // Success
          const videoUrl = d.generated_video?.[0]?.video_url || d.generated_video?.[0]?.video_uri;
          return { done: true, data: { video_url: videoUrl, thumbnail: d.thumbnail_url } };
        }

        if (d.status === 3) {
          return { failed: true, error: d.error_message || 'GeminiGen generation failed' };
        }

        return { done: false, progress: d.status_percentage ? `${d.status_percentage}%` : 'processing' };
      };
    },

    normalize(result) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{
          url: result.video_url || '',
          ...(result.thumbnail && { thumbnail: result.thumbnail }),
        }],
      };
    },
  },

  'siliconflow': {
    name: 'SiliconFlow',
    pattern: 'async-task',
    modes: ['t2v', 'i2v'],
    defaultModel: 'Wan-AI/Wan2.1-T2V-14B',

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://api.siliconflow.cn/v1';
      let model = (body.model || '').replace(/^siliconflow\//, '').replace(/^sf\//, '');

      // Auto-select T2V vs I2V model
      if (!model) {
        model = mode === 'i2v' ? 'Wan-AI/Wan2.1-I2V-14B-720P' : this.defaultModel;
      }

      const dims = parseSize(body.size);
      // SiliconFlow expects WxH string
      const imageSize = `${dims.width}x${dims.height}`;

      const reqBody = {
        model,
        prompt: body.prompt || '',
        image_size: imageSize,
      };

      // I2V: add image as data URL
      if (mode === 'i2v' || mode === 'f2v') {
        reqBody.image = body.image_url || body.image || body.first_frame;
      }

      const resp = await httpRequest(`${baseUrl}/video/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: reqBody,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400) {
        throw new Error(`SiliconFlow submit failed (${resp.status}): ${resp.raw}`);
      }

      const requestId = resp.data?.requestId;
      if (!requestId) throw new Error('SiliconFlow: No requestId returned');

      return { requestId, baseUrl, apiKey: config.apiKey };
    },

    async poll(ctx) {
      return async (_attempt) => {
        // SiliconFlow uses POST for status check
        const resp = await httpRequest(`${ctx.baseUrl}/video/status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ctx.apiKey}`,
          },
          body: { requestId: ctx.requestId },
          timeout: 15000,
        });

        const d = resp.data;
        const status = (d.status || '').toLowerCase();

        if (status === 'succeed') {
          const videoUrl = d.results?.videos?.[0]?.url;
          return { done: true, data: { video_url: videoUrl } };
        }

        if (status === 'failed') {
          return { failed: true, error: d.reason || 'SiliconFlow generation failed' };
        }

        return { done: false, progress: status };
      };
    },

    normalize(result) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: result.video_url || '' }],
      };
    },
  },

  'aimlapi': {
    name: 'AIML API (BytePlus Proxy)',
    pattern: 'async-task',
    modes: ['t2v'],
    defaultModel: 'bytedance/seedance-1-0-lite-t2v',

    async submit(body, _mode, config) {
      const baseUrl = config.baseUrl || 'https://api.aimlapi.com';
      const model = (body.model || '').replace(/^aimlapi\//, '').replace(/^aiml\//, '') || this.defaultModel;

      const ar = body.aspect_ratio || sizeToAspectRatio(body.size);
      const arMap = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' };

      const reqBody = {
        model,
        prompt: body.prompt || '',
        resolution: body.quality || '480p',
        duration: Math.min(body.duration || 5, 5),
        aspect_ratio: arMap[ar] || 'landscape',
        watermark: false,
      };

      const resp = await httpRequest(`${baseUrl}/v2/video/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: reqBody,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400) {
        const errMsg = resp.data?.error?.message || resp.raw;
        throw new Error(`AIML API submit failed (${resp.status}): ${errMsg}`);
      }

      const taskId = resp.data?.id;
      if (!taskId) throw new Error('AIML API: No task ID returned');

      return { taskId, baseUrl, apiKey: config.apiKey };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(`${ctx.baseUrl}/v2/video/generations/${ctx.taskId}`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
          timeout: 15000,
        });

        const d = resp.data;
        const status = (d.status || '').toLowerCase();

        if (status === 'completed') {
          return { done: true, data: { video_url: d.output?.video_url } };
        }

        if (status === 'failed') {
          return { failed: true, error: d.error || 'AIML API generation failed' };
        }

        return { done: false, progress: status };
      };
    },

    normalize(result) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: result.video_url || '' }],
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Pattern B: Queue-Based (Fal.ai, Replicate)
  // ══════════════════════════════════════════════════════════════════════════

  'falai': {
    name: 'Fal.ai',
    pattern: 'async-queue',
    modes: ['t2v', 'i2v'],
    defaultModel: 'fal-ai/cogvideox-5b',

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://queue.fal.run';
      const rawModel = (body.model || '').replace(/^falai\//, '').replace(/^fal\//, '');
      const model = rawModel || this.defaultModel;

      const input = {
        prompt: body.prompt || '',
        ...(body.negative_prompt && { negative_prompt: body.negative_prompt }),
        ...(body.seed != null && { seed: body.seed }),
        ...(body.duration && { num_frames: Math.round((body.duration || 5) * (body.fps || 24)) }),
      };

      // I2V: add image
      if (mode === 'i2v' || mode === 'f2v') {
        input.image_url = body.image_url || body.image || body.first_frame;
      }

      // Size
      if (body.size) {
        const dims = parseSize(body.size);
        input.width = dims.width;
        input.height = dims.height;
      }

      const resp = await httpRequest(`${baseUrl}/${model}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Key ${config.apiKey}`,
        },
        body: input,
        timeout: VIDEO_NORMALIZER_CONFIG.submitTimeout,
      });

      if (resp.status >= 400) {
        throw new Error(`Fal.ai submit failed (${resp.status}): ${resp.raw}`);
      }

      const requestId = resp.data.request_id;
      if (!requestId) throw new Error('Fal.ai: No request_id returned');

      return { requestId, baseUrl, model, apiKey: config.apiKey };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(
          `${ctx.baseUrl}/${ctx.model}/requests/${ctx.requestId}/status`,
          {
            method: 'GET',
            headers: { 'Authorization': `Key ${ctx.apiKey}` },
            timeout: 15000,
          }
        );

        const d = resp.data;
        const status = (d.status || '').toUpperCase();

        if (status === 'COMPLETED') {
          // Fetch full result
          const resultResp = await httpRequest(
            `${ctx.baseUrl}/${ctx.model}/requests/${ctx.requestId}`,
            {
              method: 'GET',
              headers: { 'Authorization': `Key ${ctx.apiKey}` },
              timeout: 30000,
            }
          );
          return { done: true, data: resultResp.data };
        }

        if (status === 'FAILED') {
          return { failed: true, error: d.error || 'Fal.ai generation failed' };
        }

        return { done: false, progress: d.progress || status };
      };
    },

    normalize(result) {
      // Fal.ai video output can be in multiple fields
      const video = result.video || result.output;
      let videoUrl;

      if (video) {
        videoUrl = typeof video === 'string' ? video : (video.url || video.video_url);
      } else if (result.videos && result.videos.length > 0) {
        const v = result.videos[0];
        videoUrl = typeof v === 'string' ? v : v.url;
      } else if (result.url) {
        videoUrl = result.url;
      }

      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: videoUrl || '' }],
      };
    },
  },

  'replicate': {
    name: 'Replicate',
    pattern: 'async-queue',
    modes: ['t2v', 'i2v'],
    defaultModel: 'tencent/hunyuan-video',

    async submit(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://api.replicate.com';
      const rawModel = (body.model || '').replace(/^replicate\//, '').replace(/^rep\//, '');
      const model = rawModel || this.defaultModel;

      const input = {
        prompt: body.prompt || '',
        ...(body.negative_prompt && { negative_prompt: body.negative_prompt }),
        ...(body.seed != null && { seed: body.seed }),
        ...(body.duration && { duration: body.duration }),
      };

      // I2V: add image
      if (mode === 'i2v' || mode === 'f2v') {
        input.image = body.image_url || body.image || body.first_frame;
      }

      // Size
      if (body.size) {
        const dims = parseSize(body.size);
        input.width = dims.width;
        input.height = dims.height;
      }

      const resp = await httpRequest(`${baseUrl}/v1/predictions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
          'Prefer': 'wait',
        },
        body: { model, input },
        timeout: VIDEO_NORMALIZER_CONFIG.syncTimeout, // Longer for Prefer: wait
      });

      if (resp.status >= 400) {
        throw new Error(`Replicate submit failed (${resp.status}): ${resp.raw}`);
      }

      const d = resp.data;

      // Replicate might return completed result immediately (Prefer: wait)
      if (d.status === 'succeeded') {
        return { immediate: true, data: d };
      }

      const predictionUrl = d.urls?.get;
      if (!predictionUrl && !d.id) throw new Error('Replicate: No prediction URL returned');

      return {
        predictionUrl: predictionUrl || `${baseUrl}/v1/predictions/${d.id}`,
        apiKey: config.apiKey,
      };
    },

    async poll(ctx) {
      return async (_attempt) => {
        const resp = await httpRequest(ctx.predictionUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${ctx.apiKey}` },
          timeout: 15000,
        });

        const d = resp.data;

        if (d.status === 'succeeded') {
          return { done: true, data: d };
        }

        if (['failed', 'canceled'].includes(d.status)) {
          return { failed: true, error: d.error || `Prediction ${d.status}` };
        }

        return { done: false, progress: d.status };
      };
    },

    normalize(result) {
      let output = result.output;
      if (!output) return { created: Math.floor(Date.now() / 1000), data: [] };
      if (!Array.isArray(output)) output = [output];

      return {
        created: Math.floor(Date.now() / 1000),
        data: output.map(o => ({
          url: typeof o === 'string' ? o : (o.url || ''),
        })),
      };
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // Pattern C: Chat-Completion-Based (synchronous)
  // ══════════════════════════════════════════════════════════════════════════

  'laozhang': {
    name: 'LaoZhang AI (Sora)',
    pattern: 'sync-chat',
    modes: ['t2v', 'i2v'],
    defaultModel: 'sora_video2',

    async generate(body, mode, config) {
      const baseUrl = config.baseUrl || 'https://api.laozhang.ai/v1';
      const model = (body.model || '').replace(/^laozhang\//, '').replace(/^lz\//, '') || this.defaultModel;

      // Build messages in OpenAI chat format
      const contentParts = [{ type: 'text', text: body.prompt || '' }];

      // I2V / F2V: add image
      if (mode === 'i2v' || mode === 'f2v') {
        const imageUrl = body.image_url || body.image || body.first_frame;
        if (imageUrl) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: imageUrl },
          });
        }
      }

      const reqBody = {
        model,
        messages: [{ role: 'user', content: contentParts }],
        stream: false,
        ...(body.duration && { max_tokens: body.duration * 30 }),
      };

      const resp = await httpRequest(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`,
        },
        body: reqBody,
        timeout: VIDEO_NORMALIZER_CONFIG.syncTimeout,
      });

      if (resp.status >= 400) {
        throw new Error(`LaoZhang failed (${resp.status}): ${resp.raw}`);
      }

      // Extract video URL from response text
      const content = resp.data?.choices?.[0]?.message?.content || '';
      const urlMatch = content.match(/https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/i)
        || content.match(/https?:\/\/[^\s"'<>]+/);

      if (!urlMatch) {
        throw new Error(`LaoZhang: No video URL found in response: ${content.slice(0, 200)}`);
      }

      return { video_url: urlMatch[0], revised_prompt: content };
    },

    normalize(result) {
      return {
        created: Math.floor(Date.now() / 1000),
        data: [{ url: result.video_url, revised_prompt: result.revised_prompt }],
      };
    },
  },
};

// ─── Provider Detection ──────────────────────────────────────────────────────

function detectVideoProvider(body) {
  const model = (body.model || '').toLowerCase();

  // Explicit provider prefix
  const prefixMatch = model.match(/^([a-z0-9_-]+)\//);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    if (VIDEO_PROVIDERS[prefix]) return prefix;
    const aliases = {
      'bp': 'byteplus',
      'seedance': 'byteplus',
      'ev': 'evolink',
      'hr': 'hypereal',
      'kling': 'hypereal',
      'lz': 'laozhang',
      'sora': 'laozhang',
      'fal': 'falai',
      'fal-ai': 'falai',
      'rep': 'replicate',
      'cogvideo': 'replicate',
      'sf': 'siliconflow',
      'wan-ai': 'siliconflow',
      'aiml': 'aimlapi',
      'bytedance': 'aimlapi',
      'gg': 'geminigen',
      'grok-aurora': 'geminigen',
    };
    if (aliases[prefix]) return aliases[prefix];
  }

  // Model name heuristics
  if (/seedance/i.test(model)) return 'byteplus';
  if (/kling/i.test(model)) return 'hypereal';
  if (/sora|sora.?video|sora.?2|sora.?character/i.test(model)) return 'laozhang';
  if (/wan\d|wan-/i.test(model)) {
    // SiliconFlow for Wan2.1 models, EvoLink for older Wan2.5/2.6
    if (/wan.?2\.?1/i.test(model)) return 'siliconflow';
    return 'evolink';
  }
  if (/veo/i.test(model)) return 'evolink';
  if (/runway/i.test(model)) return 'kie';
  if (/hailuo/i.test(model)) return 'evolink';
  if (/cogvideo/i.test(model)) return 'falai';
  if (/hunyuan/i.test(model)) return 'replicate';
  if (/animatediff|ltx/i.test(model)) return 'falai';
  if (/grok.?aurora|grok.?imagine/i.test(model)) return 'geminigen';
  if (/grok/i.test(model)) return 'geminigen'; // GeminiGen proxies Grok
  if (/pixverse/i.test(model)) return 'evolink';
  if (/nano.?banana/i.test(model)) return 'geminigen';

  // No match — pass through to OmniRoute
  return null;
}

// ─── Core Request Processor ──────────────────────────────────────────────────

async function processVideoRequest(requestBody, providerOverrides) {
  const provider = detectVideoProvider(requestBody);
  if (!provider) return null; // Pass through

  const reg = VIDEO_PROVIDERS[provider];
  if (!reg) return null;

  const mode = detectMode(requestBody);

  // Validate mode support
  if (!reg.modes.includes(mode)) {
    throw new Error(`${reg.name} does not support ${mode} mode. Supported: ${reg.modes.join(', ')}`);
  }

  const config = {
    apiKey: providerOverrides.apiKey || '',
    baseUrl: providerOverrides.baseUrl || '',
  };

  console.log(`[video-normalizer] Routing to ${reg.name} (mode: ${mode}, pattern: ${reg.pattern})`);
  const startTime = Date.now();
  let success = true;

  try {
    let result;

    if (reg.pattern === 'sync-chat') {
      // Synchronous provider (LaoZhang)
      result = await reg.generate(requestBody, mode, config);
    } else {
      // Async providers: submit → poll → collect
      const submitCtx = await reg.submit(requestBody, mode, config);

      // Some providers return immediate results (Replicate with Prefer: wait)
      if (submitCtx.immediate) {
        result = submitCtx.data;
      } else {
        const pollFn = await reg.poll(submitCtx);
        result = await pollUntilDone(pollFn, reg.name);
      }
    }

    const normalized = reg.normalize(result);
    return _ensureVideoFormat(normalized);

  } catch (err) {
    success = false;
    throw err;
  } finally {
    const duration = Date.now() - startTime;
    recordStats(provider, mode, duration, success);
  }
}

// ─── Response Validation ─────────────────────────────────────────────────────

function _ensureVideoFormat(data) {
  if (data && Array.isArray(data.data) && data.created) {
    // Validate each entry has a url
    data.data = data.data.map(item => ({
      url: item.url || '',
      ...(item.revised_prompt && { revised_prompt: item.revised_prompt }),
      ...(item.duration != null && { duration: item.duration }),
      ...(item.width && { width: item.width }),
      ...(item.height && { height: item.height }),
      ...(item.seed != null && { seed: item.seed }),
    }));
    return data;
  }

  // Try to extract from raw data
  if (typeof data === 'string') {
    return { created: Math.floor(Date.now() / 1000), data: [{ url: data }] };
  }

  if (data && data.video_url) {
    return { created: Math.floor(Date.now() / 1000), data: [{ url: data.video_url }] };
  }

  return { created: Math.floor(Date.now() / 1000), data: data?.data || [] };
}

function _parseResolution(res) {
  if (!res) return { width: null, height: null };
  const match = String(res).match(/(\d+)\s*x\s*(\d+)/i);
  if (match) return { width: parseInt(match[1]), height: parseInt(match[2]) };
  return { width: null, height: null };
}

// ─── Statistics ──────────────────────────────────────────────────────────────

const stats = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  byProvider: {},
  byMode: { t2v: 0, i2v: 0, f2v: 0, passthrough: 0 },
  avgResponseTime: 0,
  lastRequest: null,
  startedAt: new Date().toISOString(),
};

function recordStats(provider, mode, duration, success) {
  stats.totalRequests++;
  if (success) stats.successfulRequests++;
  else stats.failedRequests++;
  stats.byMode[mode] = (stats.byMode[mode] || 0) + 1;
  stats.lastRequest = new Date().toISOString();

  if (!stats.byProvider[provider]) {
    stats.byProvider[provider] = { requests: 0, success: 0, failed: 0, avgTime: 0, lastUsed: null };
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
    registeredProviders: Object.keys(VIDEO_PROVIDERS).length,
    providerDetails: Object.entries(VIDEO_PROVIDERS).map(([id, r]) => ({
      id, name: r.name, pattern: r.pattern, modes: r.modes,
    })),
  };
}

// ─── Request Body Parser ─────────────────────────────────────────────────────

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const maxSize = 100 * 1024 * 1024; // 100MB for video-related uploads

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxSize) {
        reject(new Error('Request body too large (max 100MB)'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { resolve(JSON.parse(raw)); }
      catch (_) { resolve({ _raw: raw, _contentType: req.headers['content-type'] }); }
    });

    req.on('error', reject);
  });
}

/**
 * Replay a consumed request body back into OmniRoute's native handler.
 */
function replayRequest(req, res, body, listener) {
  const bodyStr = JSON.stringify(body);
  const { Readable } = require('stream');
  const fakeStream = new Readable({ read() { this.push(bodyStr); this.push(null); } });

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
  Object.defineProperty(fakeStream, 'complete', { get: () => true });

  return listener.call(this, fakeStream, res);
}

function errorToStatusCode(err) {
  const msg = err.message || '';
  if (msg.includes('timed out') || msg.includes('Timed out')) return 504;
  if (msg.includes('401') || msg.includes('unauthorized')) return 401;
  if (msg.includes('403') || msg.includes('forbidden')) return 403;
  if (msg.includes('429') || msg.includes('rate limit')) return 429;
  if (msg.includes('404') || msg.includes('not found')) return 404;
  if (msg.includes('too large')) return 413;
  if (msg.includes('submit failed')) return 502;
  if (msg.includes('does not support')) return 400;
  return 500;
}

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

      const patchedListener = function videoNormalizerListener(req, res) {

        // ── Monitoring API ──

        if (req.url === '/api/video-normalizer/stats' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(getStats(), null, 2));
          return;
        }

        if (req.url === '/api/video-normalizer/providers' && req.method === 'GET') {
          const providers = Object.entries(VIDEO_PROVIDERS).map(([id, r]) => ({
            id, name: r.name, pattern: r.pattern, modes: r.modes,
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ providers, total: providers.length }, null, 2));
          return;
        }

        if (req.url === '/api/video-normalizer/health' && req.method === 'GET') {
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

        // ── Video generation endpoint ──

        if (req.method === 'POST' && req.url === '/v1/videos/generations') {
          collectBody(req).then(async (body) => {
            const authHeader = req.headers['authorization'] || '';
            const apiKey = authHeader.replace(/^Bearer\s+/i, '').replace(/^Key\s+/i, '').trim();

            const providerOverrides = {
              apiKey: body._providerApiKey || apiKey,
              baseUrl: body._providerBaseUrl || '',
            };

            try {
              const result = await processVideoRequest(body, providerOverrides);

              if (result === null) {
                // Pass through to OmniRoute native handler
                replayRequest(req, res, body, listener);
                stats.byMode.passthrough = (stats.byMode.passthrough || 0) + 1;
                return;
              }

              res.writeHead(200, {
                'Content-Type': 'application/json',
                'X-Video-Normalizer': 'true',
                'X-Provider': detectVideoProvider(body) || 'unknown',
                'X-Mode': detectMode(body),
              });
              res.end(JSON.stringify(result));

            } catch (err) {
              console.error(`[video-normalizer] Error: ${err.message}`);
              const provider = detectVideoProvider(body);
              recordStats(provider || 'unknown', detectMode(body), 0, false);

              const statusCode = errorToStatusCode(err);
              res.writeHead(statusCode, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: {
                  message: err.message,
                  type: 'video_normalizer_error',
                  provider: provider || 'unknown',
                  mode: detectMode(body),
                  code: statusCode,
                },
              }));
            }
          }).catch((err) => {
            console.error(`[video-normalizer] Body parse error: ${err.message}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: { message: 'Failed to parse request body: ' + err.message, type: 'invalid_request_error' },
            }));
          });
          return;
        }

        // Not a video request — pass through
        return listener.call(this, req, res);
      };

      return originalCreateServer.call(this, options, patchedListener);
    };

    console.log('[video-normalizer] ✅ HTTP server patched for video API normalization');
  } catch (e) {
    console.error('[video-normalizer] ✖ Failed to patch HTTP server:', e.message);
  }
}

// ─── Execution ───────────────────────────────────────────────────────────────

function applyPatch() {
  if (!VIDEO_NORMALIZER_CONFIG.enabled) {
    console.log('[video-normalizer] ⚠️ Patch disabled by config');
    return;
  }

  patchHttpServer();

  // Expose globally
  global.videoNormalizer = {
    processVideoRequest,
    detectVideoProvider,
    detectMode,
    getStats,
    VIDEO_PROVIDERS,
  };

  const providerCount = Object.keys(VIDEO_PROVIDERS).length;
  const modeSet = new Set();
  for (const p of Object.values(VIDEO_PROVIDERS)) {
    for (const m of p.modes) modeSet.add(m);
  }

  console.log('[video-normalizer] 🚀 Video API normalization active');
  console.log(`[video-normalizer] 📊 ${providerCount} providers registered`);
  console.log(`[video-normalizer] 📊 Modes: ${Array.from(modeSet).join(', ')}`);
  console.log('[video-normalizer] 📊 Endpoints:');
  console.log('  - POST /v1/videos/generations   (t2v, i2v, f2v)');
  console.log('  - GET  /api/video-normalizer/stats');
  console.log('  - GET  /api/video-normalizer/providers');
  console.log('  - GET  /api/video-normalizer/health');
}

applyPatch();
