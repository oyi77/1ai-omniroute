/**
 * Test: Max Tokens Guard
 * =======================
 * Tests token capping for various model names.
 */

'use strict';

const assert = require('assert');

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

console.log('\n🧪 Test: Max Tokens Guard\n');

// Load hooks and the max-tokens-guard patch
require('../patches/000-patch-hooks.cjs');
require('../patches/max-tokens-guard.cjs');

// ── Tests ────────────────────────────────────────────────────────────────────

test('Fetch interceptor registered', () => {
    const hooks = global.__patchHooks.getRegisteredHooks();
    const names = hooks.fetch.map(h => h.name);
    assert.ok(names.includes('max-tokens-guard'), 'max-tokens-guard should be registered');
});

asyncTest('Caps max_tokens for claude-3-haiku to 4096', async () => {
    let capturedBody = null;

    // Register a test interceptor with lowest priority to see the modified body
    global.__patchHooks.registerFetchInterceptor('test-cap-inspector', async (url, options, next) => {
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (urlStr.includes('/test-anthropic/v1/messages')) {
            capturedBody = JSON.parse(options.body);
            return new Response('ok', { status: 200 });
        }
        return next(url, options);
    }, { priority: 999 });

    await fetch('http://localhost:99999/test-anthropic/v1/messages', {
        method: 'POST',
        body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 64000 }),
    });

    assert.ok(capturedBody, 'Body should have been captured');
    assert.ok(capturedBody.max_tokens <= 4096,
        `max_tokens should be capped to 4096, got ${capturedBody.max_tokens}`);
});

asyncTest('Does not modify max_tokens when within model limit', async () => {
    let capturedBody = null;

    global.__patchHooks.registerFetchInterceptor('test-nocap-inspector', async (url, options, next) => {
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (urlStr.includes('/test-anthropic-nocap/v1/messages')) {
            capturedBody = JSON.parse(options.body);
            return new Response('ok', { status: 200 });
        }
        return next(url, options);
    }, { priority: 999 });

    await fetch('http://localhost:99999/test-anthropic-nocap/v1/messages', {
        method: 'POST',
        body: JSON.stringify({ model: 'claude-sonnet-4', max_tokens: 8000 }),
    });

    assert.ok(capturedBody, 'Body should have been captured');
    assert.strictEqual(capturedBody.max_tokens, 8000,
        `max_tokens should remain 8000 (within limit 16000), got ${capturedBody.max_tokens}`);
});

asyncTest('Ensures max_tokens is at least 1', async () => {
    let capturedBody = null;

    global.__patchHooks.registerFetchInterceptor('test-min-inspector', async (url, options, next) => {
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (urlStr.includes('/test-anthropic-min/v1/messages')) {
            capturedBody = JSON.parse(options.body);
            return new Response('ok', { status: 200 });
        }
        return next(url, options);
    }, { priority: 999 });

    await fetch('http://localhost:99999/test-anthropic-min/v1/messages', {
        method: 'POST',
        body: JSON.stringify({ model: 'claude-3-haiku', max_tokens: -33408 }),
    });

    assert.ok(capturedBody, 'Body should have been captured');
    assert.strictEqual(capturedBody.max_tokens, 1,
        `Negative max_tokens should be capped to 1, got ${capturedBody.max_tokens}`);
});

asyncTest('Ignores non-Anthropic URLs', async () => {
    let capturedBody = null;

    global.__patchHooks.registerFetchInterceptor('test-ignore-inspector', async (url, options, next) => {
        const urlStr = typeof url === 'string' ? url : url?.url || '';
        if (urlStr.includes('/test-not-anthropic/v1/chat/completions')) {
            capturedBody = JSON.parse(options.body);
            return new Response('ok', { status: 200 });
        }
        return next(url, options);
    }, { priority: 999 });

    await fetch('http://localhost:99999/test-not-anthropic/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 99999 }),
    });

    assert.ok(capturedBody, 'Body should have been captured');
    assert.strictEqual(capturedBody.max_tokens, 99999,
        `Non-Anthropic URLs should not be modified, got ${capturedBody.max_tokens}`);
});

// ── Summary ──────────────────────────────────────────────────────────────────

setTimeout(() => {
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    process.exit(failed > 0 ? 1 : 0);
}, 300);
