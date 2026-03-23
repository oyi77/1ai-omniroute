
// FORCE_TOKEN_REFRESH - Auto refresh tokens on 401/403/502 errors
import { refreshAccessToken } from "../services/tokenRefresh.ts";
import { getProviderConnections, updateProviderConnection } from "../lib/localDb.ts";

async function forceRefreshToken(connectionId, provider, refreshToken, credentials) {
  try {
    const result = await refreshAccessToken(provider, refreshToken, credentials, console);
    if (result && result.accessToken) {
      await updateProviderConnection(connectionId, {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        token_expires_at: result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000).toISOString() : null,
        error_code: null,
        last_error: null,
      });
      console.log("[FORCE_REFRESH] Successfully refreshed token for", connectionId);
      return result.accessToken;
    }
  } catch (e) {
    console.error("[FORCE_REFRESH] Failed to refresh token:", e.message);
  }
  return null;
}

import crypto from "crypto";
import { BaseExecutor } from "./base.ts";
import { PROVIDERS, OAUTH_ENDPOINTS, HTTP_STATUS } from "../config/constants.ts";

const MAX_RETRY_AFTER_MS = 10000;

/**
 * Strip provider prefixes (e.g. "antigravity/model" → "model").
 * Ensures the model name sent to the upstream API never contains a routing prefix.
 */
function cleanModelName(model: string): string {
  if (!model) return model;
  return model.includes("/") ? model.split("/").pop()! : model;
}

export class AntigravityExecutor extends BaseExecutor {
  constructor() {
    super("antigravity", PROVIDERS.antigravity);
  }

  buildUrl(model, stream, urlIndex = 0) {
    const baseUrls = this.getBaseUrls();
    const baseUrl = baseUrls[urlIndex] || baseUrls[0];
    const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${baseUrl}/v1internal:${action}`;
  }

  buildHeaders(credentials, stream = true) {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      "User-Agent": this.config.headers?.["User-Agent"] || "antigravity/1.104.0 darwin/arm64",
      "X-OmniRoute-Source": "omniroute",
      ...(stream && { Accept: "text/event-stream" }),
    };
  }

  async fetchProjectId(credentials, log) {
    if (!credentials.accessToken) return null;

    try {
      const loadCodeAssistEndpoint = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
      const onboardUserEndpoint = "https://cloudcode-pa.googleapis.com/v1internal:onboardUser";
      const headers = {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "google-api-nodejs-client/9.15.1",
        "X-Goog-Api-Client": "gl-js/(unknown)+gccl/(unknown)",
        "Client-Metadata": '{"ideType":"IDE_UNSPECIFIED","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}',
      };

      // Step 1: Call loadCodeAssist to check current state
      const response = await fetch(loadCodeAssistEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (!response.ok) {
        log?.warn?.("ANTIGRAVITY", `loadCodeAssist failed: ${response.status}`);
        return null;
      }

      const data = await response.json();
      
      // Extract existing project ID if present
      let projectId = data.cloudaicompanionProject;
      if (typeof projectId === "object" && projectId !== null && projectId.id) {
        projectId = projectId.id;
      }

      if (projectId) {
        log?.info?.("ANTIGRAVITY", `Found existing projectId: ${projectId}`);
        return projectId;
      }

      // Step 2: No projectId found - try to auto-provision one via onboardUser
      // This is needed because Google changed their API on Jan 15, 2026
      // Accounts without valid projectId need to be onboarded
      log?.info?.("ANTIGRAVITY", "No projectId found, attempting auto-provision via onboardUser...");
      
      const tierId = data.allowedTiers?.[0]?.id || "standard-tier";
      const onboardResponse = await fetch(onboardUserEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tierId,
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      });

      if (!onboardResponse.ok) {
        const errorText = await onboardResponse.text().catch(() => "");
        log?.warn?.("ANTIGRAVITY", `onboardUser failed: ${onboardResponse.status} - ${errorText}`);
        return null;
      }

      const onboardData = await onboardResponse.json();
      
      // Poll until onboarding completes (it's async)
      for (let attempt = 0; attempt < 10; attempt++) {
        if (onboardData.done) {
          // Extract projectId from completed onboarding
          let finalProjectId = onboardData.response?.cloudaicompanionProject;
          if (typeof finalProjectId === "object" && finalProjectId?.id) {
            finalProjectId = finalProjectId.id;
          }
          
          if (finalProjectId) {
            log?.info?.("ANTIGRAVITY", `Auto-provisioned projectId: ${finalProjectId}`);
            return finalProjectId;
          }
        }
        
        // Check again after delay
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const checkResponse = await fetch(onboardUserEndpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            tierId,
            metadata: {
              ideType: "IDE_UNSPECIFIED",
              platform: "PLATFORM_UNSPECIFIED",
              pluginType: "GEMINI",
            },
            cloudaicompanionProject: onboardData.response?.cloudaicompanionProject || "",
          }),
        });

        if (checkResponse.ok) {
          const checkData = await checkResponse.json();
          if (checkData.done) {
            let finalProjectId = checkData.response?.cloudaicompanionProject;
            if (typeof finalProjectId === "object" && finalProjectId?.id) {
              finalProjectId = finalProjectId.id;
            }
            if (finalProjectId) {
              log?.info?.("ANTIGRAVITY", `Auto-provisioned projectId: ${finalProjectId}`);
              return finalProjectId;
            }
          }
        }
      }

      log?.warn?.("ANTIGRAVITY", "Auto-provisioning timeout - user may need to reconnect OAuth");
      return null;
    } catch (error) {
      log?.warn?.("ANTIGRAVITY", `fetchProjectId error: ${error.message}`);
      return null;
    }
  }

  transformRequest(model, body, stream, credentials) {
    const bodyProjectId = body?.project;
    const credentialsProjectId = credentials?.projectId;
    const allowBodyProjectOverride = process.env.OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE === "1";

    // Default: prefer OAuth-stored projectId over incoming body.project to avoid
    // stale/wrong client-side values causing 404/403 from Cloud Code endpoints.
    // Opt-in escape hatch: set OMNIROUTE_ALLOW_BODY_PROJECT_OVERRIDE=1.
    const projectId =
      allowBodyProjectOverride && bodyProjectId ? bodyProjectId : credentialsProjectId || bodyProjectId;

    if (!projectId) {
      throw new Error(
        "Missing Google projectId for Antigravity. " +
        "Please reconnect OAuth in Settings → Providers → Antigravity."
      );
    }

    // Fix contents for Claude models via Antigravity
    const normalizedContents =
      body.request?.contents?.map((c) => {
        let role = c.role;
        // functionResponse must be role "user" for Claude models
        if (c.parts?.some((p) => p.functionResponse)) {
          role = "user";
        }

        // Strip thought parts (no valid signature -> provider rejects).
        // Also drop entries that become empty after filtering, which can trigger
        // 400 invalid argument on Gemini 3 Flash through Antigravity.
        const parts = c.parts?.filter((p) => !p.thought && !p.thoughtSignature) || [];
        return { ...c, role, parts };
      }) || [];

    const contents = normalizedContents.filter((c) =>
      Array.isArray(c.parts) ? c.parts.length > 0 : true
    );

    // Claude/Google requires conversation to end with user message, not assistant
    // Remove empty trailing assistant messages that cause 400 prefill error
    while (contents.length > 0 && 
           contents[contents.length - 1].role === "model" &&
           (!contents[contents.length - 1].parts || contents[contents.length - 1].parts.length === 0)) {
      contents.pop();
    }

    const transformedRequest = {
      ...body.request,
      ...(contents.length > 0 && { contents }),
      sessionId: body.request?.sessionId || this.generateSessionId(),
      safetySettings: undefined,
      toolConfig:
        body.request?.tools?.length > 0
          ? { functionCallingConfig: { mode: "VALIDATED" } }
          : body.request?.toolConfig,
    };

    const upstreamModel = cleanModelName(model);

    return {
      ...body,
      project: projectId,
      model: upstreamModel,
      userAgent: "antigravity",
      requestType: "agent",
      requestId: `agent-${crypto.randomUUID()}`,
      request: transformedRequest,
    };
  }

  async refreshCredentials(credentials, log) {
    if (!credentials.refreshToken) return null;

    try {
      const response = await fetch(OAUTH_ENDPOINTS.google.token, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credentials.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }),
      });

      if (!response.ok) return null;

      const tokens = await response.json();
      log?.info?.("TOKEN", "Antigravity refreshed");

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || credentials.refreshToken,
        expiresIn: tokens.expires_in,
        projectId: credentials.projectId,
      };
    } catch (error) {
      log?.error?.("TOKEN", `Antigravity refresh error: ${error.message}`);
      return null;
    }
  }

  generateSessionId() {
    return `-${Math.floor(Math.random() * 9_000_000_000_000_000_000)}`;
  }

  parseRetryHeaders(headers) {
    if (!headers?.get) return null;

    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;

      const date = new Date(retryAfter);
      if (!isNaN(date.getTime())) {
        const diff = date.getTime() - Date.now();
        return diff > 0 ? diff : null;
      }
    }

    const resetAfter = headers.get("x-ratelimit-reset-after");
    if (resetAfter) {
      const seconds = parseInt(resetAfter, 10);
      if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
    }

    const resetTimestamp = headers.get("x-ratelimit-reset");
    if (resetTimestamp) {
      const ts = parseInt(resetTimestamp, 10) * 1000;
      const diff = ts - Date.now();
      return diff > 0 ? diff : null;
    }

    return null;
  }

  // Parse retry time from Antigravity error message body
  // Format: "Your quota will reset after 2h7m23s" or "1h30m" or "45m" or "30s"
  parseRetryFromErrorMessage(errorMessage) {
    if (!errorMessage || typeof errorMessage !== "string") return null;

    const match = errorMessage.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
    if (!match) return null;

    let totalMs = 0;
    if (match[1]) totalMs += parseInt(match[1]) * 3600 * 1000; // hours
    if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000; // minutes
    if (match[3]) totalMs += parseInt(match[3]) * 1000; // seconds

    return totalMs > 0 ? totalMs : null;
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const MAX_AUTO_RETRIES = 3;
    const retryAttemptsByUrl = {}; // Track retry attempts per URL

    // Auto-fetch projectId if missing (handles connections without projectId from old OAuth)
    if (!credentials.projectId && credentials.accessToken) {
      log?.info?.("ANTIGRAVITY", "No projectId found, attempting to fetch from loadCodeAssist...");
      const fetchedProjectId = await this.fetchProjectId(credentials, log);
      if (fetchedProjectId) {
        credentials.projectId = fetchedProjectId;
        log?.info?.("ANTIGRAVITY", `Successfully fetched and set projectId: ${fetchedProjectId}`);
      } else {
        log?.warn?.("ANTIGRAVITY", "Could not fetch projectId - user may need to reconnect OAuth");
      }
    }

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex);
      const headers = this.buildHeaders(credentials, stream);
      
      let transformedBody;
      try {
        transformedBody = this.transformRequest(model, body, stream, credentials);
      } catch (transformError) {
        // If transform fails due to missing projectId and we haven't tried fetching yet
        if (transformError.message?.includes("Missing Google projectId") && credentials.accessToken) {
          log?.info?.("ANTIGRAVITY", "Transform failed - retrying with projectId fetch...");
          const fetchedProjectId = await this.fetchProjectId(credentials, log);
          if (fetchedProjectId) {
            credentials.projectId = fetchedProjectId;
            // Retry transform with new projectId
            transformedBody = this.transformRequest(model, body, stream, credentials);
            log?.info?.("ANTIGRAVITY", `Retry successful with projectId: ${fetchedProjectId}`);
          } else {
            throw transformError; // Re-throw original error if fetch also fails
          }
        } else {
          throw transformError;
        }
      }

      // Initialize retry counter for this URL
      if (!retryAttemptsByUrl[urlIndex]) {
        retryAttemptsByUrl[urlIndex] = 0;
      }

      try {
        const response = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal,
        });

        if (
          response.status === HTTP_STATUS.RATE_LIMITED ||
          response.status === HTTP_STATUS.SERVICE_UNAVAILABLE
        ) {
          // Try to get retry time from headers first
          let retryMs = this.parseRetryHeaders(response.headers);

          // If no retry time in headers, try to parse from error message body
          if (!retryMs) {
            try {
              const errorBody = await response.clone().text();
              const errorJson = JSON.parse(errorBody);
              const errorMessage = errorJson?.error?.message || errorJson?.message || "";
              retryMs = this.parseRetryFromErrorMessage(errorMessage);
            } catch (e) {
              // Ignore parse errors, will fall back to exponential backoff
            }
          }

          if (retryMs && retryMs <= MAX_RETRY_AFTER_MS) {
            log?.debug?.(
              "RETRY",
              `${response.status} with Retry-After: ${Math.ceil(retryMs / 1000)}s, waiting...`
            );
            await new Promise((resolve) => setTimeout(resolve, retryMs));
            urlIndex--;
            continue;
          }

          // Auto retry only for 429 when retryMs is 0 or undefined
          if (
            response.status === HTTP_STATUS.RATE_LIMITED &&
            (!retryMs || retryMs === 0) &&
            retryAttemptsByUrl[urlIndex] < MAX_AUTO_RETRIES
          ) {
            retryAttemptsByUrl[urlIndex]++;
            // Exponential backoff: 2s, 4s, 8s...
            const backoffMs = Math.min(
              1000 * 2 ** retryAttemptsByUrl[urlIndex],
              MAX_RETRY_AFTER_MS
            );
            log?.debug?.(
              "RETRY",
              `429 auto retry ${retryAttemptsByUrl[urlIndex]}/${MAX_AUTO_RETRIES} after ${backoffMs / 1000}s`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            urlIndex--;
            continue;
          }

          log?.debug?.(
            "RETRY",
            `${response.status}, Retry-After ${retryMs ? `too long (${Math.ceil(retryMs / 1000)}s)` : "missing"}, trying fallback`
          );
          lastStatus = response.status;

          if (urlIndex + 1 < fallbackCount) {
            continue;
          }
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error) {
        lastError = error;
        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }
}

export default AntigravityExecutor;
