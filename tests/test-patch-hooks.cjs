/**
 * Test: Patch Hooks — Centralized Middleware System
 * ==================================================
 * Tests the core hook system that all patches depend on.
 */

'use strict';

const assert = require('assert');
const http = require('http');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (e) {
        failed++;
        console.log(`  ❌ ${name}: ${e.message}`);
    }
}

console.log('\n🧪 Test: Patch Hooks\n');

// ── Setup: Load the hooks module ─────────────────────────────────────────────
// Save originals before patch-hooks modifies them
const originalCreateServer = http.createServer;
const originalFetch = globalThis.fetch;

// Load the hooks (this modifies http.createServer and globalThis.fetch)
require('../patches/000-patch-hooks.cjs');

// ── Test: Global registration ────────────────────────────────────────────────

test('global.__patchHooks exists after loading', () => {
    assert.ok(global.__patchHooks, 'global.__patchHooks should be defined');
});

test('registerHttpMiddleware function exists', () => {
    assert.strictEqual(typeof global.__patchHooks.registerHttpMiddleware, 'function');
});

test('registerFetchInterceptor function exists', () => {
    assert.strictEqual(typeof global.__patchHooks.registerFetchInterceptor, 'function');
});

test('getRegisteredHooks function exists', () => {
    assert.strictEqual(typeof global.__patchHooks.getRegisteredHooks, 'function');
});

// ── Test: HTTP Middleware chain ───────────────────────────────────────────────

test('HTTP middleware registration works', () => {
    const calls = [];
    global.__patchHooks.registerHttpMiddleware('test-mw-1', (req, res, next) => {
        calls.push('mw-1');
        next();
    }, { priority: 20 });

    global.__patchHooks.registerHttpMiddleware('test-mw-2', (req, res, next) => {
        calls.push('mw-2');
        next();
    }, { priority: 10 }); // Lower priority = runs first

    const hooks = global.__patchHooks.getRegisteredHooks();
    const httpNames = hooks.http.map(h => h.name);
    assert.ok(httpNames.includes('test-mw-1'), 'test-mw-1 should be registered');
    assert.ok(httpNames.includes('test-mw-2'), 'test-mw-2 should be registered');
});

test('HTTP middleware respects priority ordering', () => {
    const hooks = global.__patchHooks.getRegisteredHooks();
    const testMiddlewares = hooks.http.filter(h => h.name.startsWith('test-mw-'));
    // mw-2 (priority 10) should come before mw-1 (priority 20)
    const mw2Idx = hooks.http.findIndex(h => h.name === 'test-mw-2');
    const mw1Idx = hooks.http.findIndex(h => h.name === 'test-mw-1');
    assert.ok(mw2Idx < mw1Idx, `mw-2 (idx ${mw2Idx}) should come before mw-1 (idx ${mw1Idx})`);
});

// Test HTTP middleware chain actually fires in order via a real server
asyncTest('HTTP middleware chain fires in priority order on requests', async () => {
    const executionOrder = [];

    global.__patchHooks.registerHttpMiddleware('test-order-a', (req, res, next) => {
        if (req.url === '/test-order') executionOrder.push('A');
        next();
    }, { priority: 30 });

    global.__patchHooks.registerHttpMiddleware('test-order-b', (req, res, next) => {
        if (req.url === '/test-order') executionOrder.push('B');
        next();
    }, { priority: 15 });

    // Create a server using the hooked createServer
    const server = http.createServer((req, res) => {
        executionOrder.push('HANDLER');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
    });

    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const req = http.request({ hostname: '127.0.0.1', port, path: '/test-order', method: 'GET' }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    server.close();
                    try {
                        // B (priority 15) should run before A (priority 30)
                        const bIdx = executionOrder.indexOf('B');
                        const aIdx = executionOrder.indexOf('A');
                        const hIdx = executionOrder.indexOf('HANDLER');
                        assert.ok(bIdx < aIdx, `B (${bIdx}) should run before A (${aIdx})`);
                        assert.ok(aIdx < hIdx, `A (${aIdx}) should run before HANDLER (${hIdx})`);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    });
});

// Test middleware that terminates the chain (doesn't call next)
asyncTest('HTTP middleware can short-circuit the chain', async () => {
    global.__patchHooks.registerHttpMiddleware('test-shortcircuit', (req, res, next) => {
        if (req.url === '/test-shortcircuit') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ intercepted: true }));
            return; // Don't call next
        }
        next();
    }, { priority: 1 });

    const server = http.createServer((req, res) => {
        res.writeHead(200);
        res.end('should not reach here');
    });

    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const req = http.request({ hostname: '127.0.0.1', port, path: '/test-shortcircuit', method: 'GET' }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    server.close();
                    try {
                        const parsed = JSON.parse(data);
                        assert.strictEqual(parsed.intercepted, true, 'Middleware should have intercepted the request');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    });
});

// ── Test: Fetch interceptor chain ────────────────────────────────────────────

test('Fetch interceptor registration works', () => {
    global.__patchHooks.registerFetchInterceptor('test-fetch-1', async (url, options, next) => {
        return next(url, options);
    }, { priority: 50 });

    const hooks = global.__patchHooks.getRegisteredHooks();
    const fetchNames = hooks.fetch.map(h => h.name);
    assert.ok(fetchNames.includes('test-fetch-1'), 'test-fetch-1 should be registered');
});

test('Fetch interceptor respects priority ordering', () => {
    global.__patchHooks.registerFetchInterceptor('test-fetch-early', async (url, options, next) => {
        return next(url, options);
    }, { priority: 5 });

    const hooks = global.__patchHooks.getRegisteredHooks();
    const earlyIdx = hooks.fetch.findIndex(h => h.name === 'test-fetch-early');
    const midIdx = hooks.fetch.findIndex(h => h.name === 'test-fetch-1');
    assert.ok(earlyIdx < midIdx, `test-fetch-early (${earlyIdx}) should come before test-fetch-1 (${midIdx})`);
});

asyncTest('Fetch interceptor can short-circuit with synthetic response', async () => {
    global.__patchHooks.registerFetchInterceptor('test-fetch-mock', async (url, options, next) => {
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (urlStr.includes('/test-mock-endpoint')) {
            return new Response(JSON.stringify({ mocked: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return next(url, options);
    }, { priority: 1 });

    const response = await fetch('http://localhost:99999/test-mock-endpoint');
    const data = await response.json();
    assert.strictEqual(data.mocked, true, 'Fetch interceptor should have returned mocked response');
});

asyncTest('Fetch interceptor can modify options before passing through', async () => {
    let capturedOptions = null;

    global.__patchHooks.registerFetchInterceptor('test-fetch-modifier', async (url, options, next) => {
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (urlStr.includes('/test-modify-endpoint')) {
            // Add a custom header
            options = { ...options, headers: { ...options.headers, 'X-Modified': 'yes' } };
            capturedOptions = options;
            return new Response('modified', { status: 200 });
        }
        return next(url, options);
    }, { priority: 2 });

    await fetch('http://localhost:99999/test-modify-endpoint', { method: 'POST', headers: {} });
    assert.strictEqual(capturedOptions.headers['X-Modified'], 'yes', 'Options should be modified');
});

// ── Test: Diagnostics endpoint ───────────────────────────────────────────────

asyncTest('Diagnostics endpoint /api/patch-hooks/status works', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(404);
        res.end('not found');
    });

    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const req = http.request({ hostname: '127.0.0.1', port, path: '/api/patch-hooks/status', method: 'GET' }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    server.close();
                    try {
                        const parsed = JSON.parse(data);
                        assert.strictEqual(parsed.status, 'active');
                        assert.ok(Array.isArray(parsed.httpMiddlewares), 'Should have httpMiddlewares array');
                        assert.ok(Array.isArray(parsed.fetchInterceptors), 'Should have fetchInterceptors array');
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    });
});

// ── Summary ──────────────────────────────────────────────────────────────────

setTimeout(() => {
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    process.exit(failed > 0 ? 1 : 0);
}, 500);
