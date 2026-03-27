/**
 * Integration Test: All Patches Together
 * ========================================
 * Loads ALL patches in the correct order and validates:
 * - All middleware registers without conflict
 * - HTTP routes from all patches respond
 * - No SSE corruption (streaming responses pass through cleanly)
 */

'use strict';

const assert = require('assert');
const http = require('http');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try { fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

async function asyncTest(name, fn) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n🧪 Integration Test: All Patches\n');

// ── Load all patches in production order ─────────────────────────────────────
console.log('Loading patches...\n');

require('../patches/000-patch-hooks.cjs');
require('../patches/endpoint-router.cjs');
require('../patches/enhanced-logging.cjs');
require('../patches/response-cache.cjs');
require('../patches/response-cleaner.cjs');
require('../patches/health-check.cjs');
require('../patches/request-logger.cjs');
require('../patches/max-tokens-guard.cjs');
require('../patches/provider-circuit-breaker.cjs');
require('../patches/provider-monitor.cjs');
require('../patches/openclaw-patch-manager.cjs');

console.log('\n--- Tests ---\n');

// ── Test: All hooks registered without conflict ──────────────────────────────

test('All HTTP middleware registered', () => {
    const hooks = global.__patchHooks.getRegisteredHooks();
    const httpNames = hooks.http.map(h => h.name);

    const expected = [
        'enhanced-logging',
        'endpoint-router',
        'patch-manager',
        'circuit-breaker',
        'provider-monitor',
        'patch-hooks-diagnostics',
    ];

    for (const name of expected) {
        assert.ok(httpNames.includes(name), `Missing HTTP middleware: ${name} (registered: ${httpNames.join(', ')})`);
    }
});

test('All fetch interceptors registered', () => {
    const hooks = global.__patchHooks.getRegisteredHooks();
    const fetchNames = hooks.fetch.map(h => h.name);

    const expected = [
        'max-tokens-guard',
        'health-check',
        'request-logger',
        'response-cache',
        'response-cleaner',
    ];

    for (const name of expected) {
        assert.ok(fetchNames.includes(name), `Missing fetch interceptor: ${name} (registered: ${fetchNames.join(', ')})`);
    }
});

test('No duplicate middleware names', () => {
    const hooks = global.__patchHooks.getRegisteredHooks();
    const httpNames = hooks.http.map(h => h.name);
    const uniqueHttp = new Set(httpNames);
    // Note: Some test registrations may exist, but production names should be unique
    const prodNames = httpNames.filter(n => !n.startsWith('test-'));
    const uniqueProd = new Set(prodNames);
    assert.strictEqual(prodNames.length, uniqueProd.size, 'HTTP middleware names should be unique');
});

// ── Test: HTTP routes from all patches work ──────────────────────────────────

let testServer;
let testPort;

async function startTestServer() {
    return new Promise((resolve) => {
        testServer = http.createServer((req, res) => {
            // Default handler — return 404 if no middleware handled it
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found', url: req.url }));
        });
        testServer.listen(0, '127.0.0.1', () => {
            testPort = testServer.address().port;
            resolve();
        });
    });
}

async function httpGet(path) {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port: testPort, path, method: 'GET' }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function httpPost(path, body) {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(body);
        const req = http.request({
            hostname: '127.0.0.1', port: testPort, path, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.write(bodyStr);
        req.end();
    });
}

// Run HTTP route tests
(async () => {
    await startTestServer();

    // Test: patch-hooks diagnostics
    await asyncTest('GET /api/patch-hooks/status returns registered hooks', async () => {
        const r = await httpGet('/api/patch-hooks/status');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.status, 'active');
        assert.ok(r.body.httpMiddlewares.length > 0);
        assert.ok(r.body.fetchInterceptors.length > 0);
    });

    // Test: circuit breaker status
    await asyncTest('GET /api/circuit-breaker/status returns circuit data', async () => {
        const r = await httpGet('/api/circuit-breaker/status');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.enabled !== undefined);
        assert.ok(r.body.summary);
    });

    // Test: circuit breaker reset
    await asyncTest('POST /api/circuit-breaker/reset works', async () => {
        const r = await httpPost('/api/circuit-breaker/reset', {});
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.body.success, true);
    });

    // Test: provider monitor stats
    await asyncTest('GET /api/provider-monitor/stats works', async () => {
        const r = await httpGet('/api/provider-monitor/stats');
        assert.strictEqual(r.status, 200);
        assert.strictEqual(typeof r.body, 'object');
    });

    // Test: provider monitor health
    await asyncTest('GET /api/provider-monitor/health works', async () => {
        const r = await httpGet('/api/provider-monitor/health');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.uptime);
    });

    // Test: endpoint router — URL aliasing
    await asyncTest('Endpoint router rewrites /v1/dalle to /v1/images/generations', async () => {
        const r = await httpGet('/v1/dalle');
        // Will hit the 404 default handler, but with rewritten URL
        assert.strictEqual(r.body.url, '/v1/images/generations',
            `Expected /v1/images/generations, got ${r.body.url}`);
    });

    await asyncTest('Endpoint router rewrites /v1/sora to /v1/videos/generations', async () => {
        const r = await httpGet('/v1/sora');
        assert.strictEqual(r.body.url, '/v1/videos/generations');
    });

    // Test: SSE streaming passthrough — ensure res.write is not buffered
    await asyncTest('Streaming SSE responses pass through without corruption', async () => {
        // Create a new server that streams SSE data
        const sseServer = http.createServer((req, res) => {
            if (req.url === '/v1/chat/completions' && req.method === 'POST') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                });

                // Write SSE chunks
                const chunks = [
                    'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
                    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
                    'data: {"choices":[{"delta":{"content":" world!"}}]}\n\n',
                    'data: [DONE]\n\n',
                ];

                let i = 0;
                const interval = setInterval(() => {
                    if (i < chunks.length) {
                        res.write(chunks[i]);
                        i++;
                    } else {
                        clearInterval(interval);
                        res.end();
                    }
                }, 10);
            } else {
                res.writeHead(404);
                res.end('not found');
            }
        });

        await new Promise((resolve, reject) => {
            sseServer.listen(0, '127.0.0.1', () => {
                const port = sseServer.address().port;
                const reqBody = JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }], stream: true });
                const req = http.request({
                    hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(reqBody) },
                }, (res) => {
                    const receivedChunks = [];
                    res.on('data', chunk => { receivedChunks.push(chunk.toString()); });
                    res.on('end', () => {
                        sseServer.close();
                        try {
                            const fullResponse = receivedChunks.join('');
                            assert.ok(fullResponse.includes('data: {"choices"'), 'SSE data should be present');
                            assert.ok(fullResponse.includes('"content":"Hello"'), 'Content should not be corrupted');
                            assert.ok(fullResponse.includes('data: [DONE]'), 'DONE sentinel should be present');
                            resolve();
                        } catch (e) {
                            reject(e);
                        }
                    });
                });
                req.on('error', reject);
                req.write(reqBody);
                req.end();
            });
        });
    });

    // Test: openclaw patches list
    await asyncTest('GET /api/openclaw/patches returns patch list', async () => {
        const r = await httpGet('/api/openclaw/patches');
        assert.strictEqual(r.status, 200);
        assert.ok(Array.isArray(r.body.patches), 'Should return patches array');
        assert.ok(r.body.total >= 0, 'Should have total count');
    });

    // Cleanup
    testServer.close();

    console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
    console.error('Integration test error:', e);
    if (testServer) testServer.close();
    process.exit(1);
});
