/**
 * OpenClaw OmniRoute Modular Patch: Response Cleaner
 * ==================================================
 * Strips 'refusal' and 'tool_calls' from model responses to maintain 
 * compatibility with older/stricter parsers like OpenClaw Gateway.
 */

'use strict';

console.log('[response-cleaner] 🧹 Response cleaner patch initialized');

/**
 * Response cleaner fetch interceptor.
 * Strips 'refusal' and empty 'tool_calls' from non-streaming chat completion responses.
 */
async function responseCleanerInterceptor(url, options, next) {
  const response = await next(url, options);

  // Only intercept chat completion responses
  const urlStr = typeof url === 'string' ? url : url?.url || '';
  if (!urlStr.includes('/chat/completions')) {
    return response;
  }

  // Clone the response to modify it
  const originalJson = response.json;
  response.json = async function () {
    const data = await originalJson.call(this);

    if (data && data.choices && Array.isArray(data.choices)) {
      data.choices.forEach(choice => {
        if (choice.message) {
          if ('refusal' in choice.message) {
            delete choice.message.refusal;
          }
          if ('tool_calls' in choice.message && (!choice.message.tool_calls || choice.message.tool_calls.length === 0)) {
            delete choice.message.tool_calls;
          }
        }
      });
    }
    return data;
  };

  return response;
}

// Apply the patch
if (global.__patchHooks) {
  // Priority 90 — run late, after caching
  global.__patchHooks.registerFetchInterceptor('response-cleaner', responseCleanerInterceptor, { priority: 90 });
  console.log('[response-cleaner] 🧹 Response cleaner active');
} else {
  console.error('[response-cleaner] ✖ patch-hooks not loaded — response-cleaner will not work');
}
