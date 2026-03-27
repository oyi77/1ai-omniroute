/**
 * Test: Response Cache
 * =====================
 * Tests cache hit/miss, TTL expiry, streaming bypass.
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

console.log('\n🧪 Test: Response Cache\n');

// Load hooks and the cache patch
require('../patches/000-patch-hooks.cjs');
require('../patches/response-cache.cjs');

// ── Tests ────────────────────────────────────────────────────────────────────

test('responseCache global is set', () => {
    assert.ok(global.responseCache, 'global.responseCache should exist');
});

test('generateKey returns null for stream=true', () => {
    const key = global.responseCache.generateKey('/v1/chat/completions', { stream: true, model: 'gpt-4o' });
    assert.strictEqual(key, null, 'Streaming requests should not generate cache keys');
});

test('generateKey returns a key for non-streaming requests', () => {
    const key = global.responseCache.generateKey('/v1/chat/completions', {
        stream: false, model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }]
    });
    assert.ok(key, 'Non-streaming requests should generate a cache key');
    assert.ok(key.startsWith('cache_'), 'Key should start with cache_');
});

test('Same request generates same key', () => {
    const body = { model: 'gpt-4o', messages: [{ role: 'user', content: 'test' }] };
    const key1 = global.responseCache.generateKey('/v1/chat/completions', body);
    const key2 = global.responseCache.generateKey('/v1/chat/completions', body);
    assert.strictEqual(key1, key2, 'Same request body should produce same cache key');
});

test('Different requests generate different keys', () => {
    const key1 = global.responseCache.generateKey('/v1/chat/completions', { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] });
    const key2 = global.responseCache.generateKey('/v1/chat/completions', { model: 'gpt-4o', messages: [{ role: 'user', content: 'world' }] });
    assert.notStrictEqual(key1, key2, 'Different request bodies should produce different cache keys');
});

test('Cache set and get works', () => {
    const key = 'test_cache_key_1';
    const data = { choices: [{ message: { content: 'cached response' } }] };
    global.responseCache.set(key, data);
    const result = global.responseCache.get(key);
    assert.deepStrictEqual(result, data, 'Cached data should match what was set');
});

test('Cache miss returns null', () => {
    const result = global.responseCache.get('nonexistent_key');
    assert.strictEqual(result, null, 'Cache miss should return null');
});

test('Cache cleanup removes expired entries', () => {
    // Manually set an expired entry
    global.responseCache.cache.set('expired_key', {
        data: { test: true },
        expiresAt: Date.now() - 1000, // Expired 1s ago
        createdAt: Date.now() - 60000,
    });
    global.responseCache.cleanup();
    const result = global.responseCache.get('expired_key');
    assert.strictEqual(result, null, 'Expired entry should be cleaned up');
});

asyncTest('Fetch interceptor is registered in patch hooks', async () => {
    const hooks = global.__patchHooks.getRegisteredHooks();
    const fetchNames = hooks.fetch.map(h => h.name);
    assert.ok(fetchNames.includes('response-cache'), 'response-cache should be registered as fetch interceptor');
});

// ── Summary ──────────────────────────────────────────────────────────────────

setTimeout(() => {
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    process.exit(failed > 0 ? 1 : 0);
}, 300);
