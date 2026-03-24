// CLIProxyAPI Sidecar Integration Patch v2
// Proxies antigravity, claude, and gemini-cli requests through CLIProxyAPI
const CLIPROXY_URL = "http://127.0.0.1:8317";
const CLIPROXY_KEY = "omniroute-internal";

const origFetch = globalThis.fetch;
globalThis.fetch = async function cliProxyFetch(url, init) {
  const urlStr = typeof url === "string" ? url : (url?.url || "");
  
  // Only intercept antigravity/gemini cloud code requests
  const isCloudCode = urlStr.includes("cloudcode-pa.googleapis.com") || urlStr.includes("daily-cloudcode-pa");
  
  if (!isCloudCode) {
    return origFetch.apply(this, arguments);
  }

  try {
    // Read request body
    let body = init?.body;
    if (body && typeof body === "string") {
      try { body = JSON.parse(body); } catch {}
    }

    // Extract model from URL or body
    const pathMatch = urlStr.match(/models\/([^/:]+)/);
    let model = body?.model || (pathMatch ? pathMatch[1] : "gemini-2.5-flash");
    
    // Map antigravity model names to CLIProxyAPI names
    const modelMap = {
      "gemini-3.1-pro": "gemini-3.1-pro-high",
      "gemini-3.1-pro-preview": "gemini-3.1-pro-high",
    };
    model = modelMap[model] || model;

    // Convert Gemini contents to OpenAI messages
    const messages = (body?.contents || []).map(c => ({
      role: c.role === "model" ? "assistant" : (c.role || "user"),
      content: (c.parts || []).map(p => p.text || JSON.stringify(p)).join("\n"),
    }));

    const isStream = urlStr.includes("streamGenerateContent");

    const proxyReq = {
      model: model,
      messages: messages,
      stream: isStream,
      max_tokens: body?.generationConfig?.maxOutputTokens,
      temperature: body?.generationConfig?.temperature,
    };
    Object.keys(proxyReq).forEach(k => proxyReq[k] == null && delete proxyReq[k]);

    const proxyUrl = `${CLIPROXY_URL}/v1/chat/completions`;
    const resp = await origFetch(proxyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CLIPROXY_KEY}`,
      },
      body: JSON.stringify(proxyReq),
    });

    if (!resp.ok) {
      console.log(`[cli-proxy] ${model} → ${resp.status}, fallback to direct`);
      return origFetch.apply(this, arguments);
    }

    // Convert OpenAI response back to Gemini format
    const text = await resp.text();
    const openai = JSON.parse(text);
    const choice = (openai.choices || [])[0] || {};
    const msg = choice.message || {};

    const geminiResp = {
      response: {
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: msg.content || "" }],
          },
          finishReason: choice.finish_reason === "stop" ? "STOP" : "STOP",
        }],
        usageMetadata: openai.usage ? {
          promptTokenCount: openai.usage.prompt_tokens || 0,
          candidatesTokenCount: openai.usage.completion_tokens || 0,
          totalTokenCount: openai.usage.total_tokens || 0,
        } : undefined,
      },
    };

    return new Response(JSON.stringify(geminiResp), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.log(`[cli-proxy] Error: ${err.message}, fallback`);
    return origFetch.apply(this, arguments);
  }
};

console.log("[cli-proxy] Sidecar patch loaded → antigravity → localhost:8317");
