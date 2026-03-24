/**
 * Antigravity 502 Router via CLIProxyAPI
 * Routes failed Antigravity requests through CLIProxyAPI
 */

const CLI_PROXY_API = "http://127.0.0.1:8317";
const ANTIGRAVITY_BASE_URL = "https://api.antigravity.ai";

async function routeThroughCLIProxyAPI(request, credentials) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/v1/, "");
  
  const proxyUrl = `${CLI_PROXY_API}/v1${path}`;
  
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${credentials.accessToken}`);
  headers.set("X-CLIProxy-Auth", "omniroute-internal");
  
  const proxyRequest = new Request(proxyUrl, {
    method: request.method,
    headers,
    body: request.body,
  });
  
  return fetch(proxyRequest);
}

function shouldRouteThroughProxy(provider, response, credentials) {
  return (
    provider === "antigravity" &&
    response?.status === 502 &&
    credentials?.accessToken
  );
}

module.exports = {
  routeThroughCLIProxyAPI,
  shouldRouteThroughProxy,
  CLI_PROXY_API,
};
