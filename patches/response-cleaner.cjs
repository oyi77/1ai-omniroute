/**
 * OpenClaw OmniRoute Modular Patch: Response Cleaner
 * ==================================================
 * Strips 'refusal' and 'tool_calls' from model responses to maintain 
 * compatibility with older/stricter parsers like OpenClaw Gateway.
 */

'use strict';

console.log('[response-cleaner] 🧹 Response cleaner patch initialized');

function patchFetch() {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async function patchedFetch(...args) {
    const response = await originalFetch.apply(this, args);
    
    // Only intercept chat completion responses
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (!url.includes('/chat/completions')) {
      return response;
    }

    // Clone the response to modify it
    const originalJson = response.json;
    response.json = async function() {
      const data = await originalJson.call(this);
      
      if (data && data.choices && Array.isArray(data.choices)) {
        let cleaned = false;
        data.choices.forEach(choice => {
          if (choice.message) {
            // Remove incompatible fields
            if ('refusal' in choice.message) {
              delete choice.message.refusal;
              cleaned = true;
            }
            if ('tool_calls' in choice.message && (!choice.message.tool_calls || choice.message.tool_calls.length === 0)) {
              delete choice.message.tool_calls;
              cleaned = true;
            }
          }
        });
        
        if (cleaned) {
          // console.log('[response-cleaner] ✨ Stripped modern fields from response for compatibility');
        }
      }
      return data;
    };

    return response;
  };
}

// Apply the patch
try {
  patchFetch();
} catch (e) {
  console.error('[response-cleaner] ❌ Failed to apply patch:', e);
}
