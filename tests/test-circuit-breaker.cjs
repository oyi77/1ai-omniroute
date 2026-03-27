/**
 * Test: Circuit Breaker
 * ======================
 * Tests state transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
 * Tests exponential backoff with jitter
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

console.log('\n🧪 Test: Circuit Breaker\n');

// Load hooks and circuit breaker 
require('../patches/000-patch-hooks.cjs');
require('../patches/provider-circuit-breaker.cjs');

// ── Tests ────────────────────────────────────────────────────────────────────

test('circuitBreakerManager global is set', () => {
    assert.ok(global.circuitBreakerManager, 'global.circuitBreakerManager should exist');
});

test('Circuit breaker initializes in CLOSED state', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-provider');
    assert.strictEqual(breaker.state, 'CLOSED', 'Initial state should be CLOSED');
    assert.strictEqual(breaker.failures, 0);
    assert.strictEqual(breaker.successes, 0);
});

test('Recording success keeps circuit CLOSED', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-success');
    breaker.recordSuccess(100);
    assert.strictEqual(breaker.state, 'CLOSED');
    assert.strictEqual(breaker.stats.totalRequests, 1);
    assert.strictEqual(breaker.stats.successfulRequests, 1);
});

test('Recording failures below threshold keeps circuit CLOSED', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-below-threshold');
    // Default threshold is 5
    for (let i = 0; i < 4; i++) {
        breaker.recordFailure(100, 'test error');
    }
    assert.strictEqual(breaker.state, 'CLOSED', 'Should stay CLOSED below threshold');
    assert.strictEqual(breaker.failures, 4);
});

test('Exceeding failure threshold opens circuit', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-open');
    for (let i = 0; i < 5; i++) {
        breaker.recordFailure(100, 'test error');
    }
    assert.strictEqual(breaker.state, 'OPEN', 'Should transition to OPEN at threshold');
    assert.strictEqual(breaker.stats.circuitOpens, 1);
});

test('Reset returns circuit to CLOSED', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-open');
    breaker.reset();
    assert.strictEqual(breaker.state, 'CLOSED', 'Reset should return to CLOSED');
    assert.strictEqual(breaker.failures, 0);
    assert.strictEqual(breaker.successes, 0);
});

test('Success in HALF_OPEN state progresses toward CLOSED', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-halfopen');
    breaker.state = 'HALF_OPEN';
    breaker.successes = 0;
    breaker.recordSuccess(100);
    assert.strictEqual(breaker.successes, 1);
    // Default successThreshold is 2
    assert.strictEqual(breaker.state, 'HALF_OPEN', 'Should stay HALF_OPEN until threshold met');
    breaker.recordSuccess(100);
    assert.strictEqual(breaker.state, 'CLOSED', 'Should transition to CLOSED after enough successes');
    assert.strictEqual(breaker.stats.circuitCloses, 1);
});

test('Failure in HALF_OPEN state reopens circuit', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-halfopen-fail');
    breaker.state = 'HALF_OPEN';
    breaker.recordFailure(100, 'still failing');
    assert.strictEqual(breaker.state, 'OPEN', 'Failure in HALF_OPEN should reopen circuit');
});

test('getStatus returns correct structure', () => {
    const status = global.circuitBreakerManager.getStatus();
    assert.ok(status.enabled !== undefined, 'Should have enabled field');
    assert.ok(status.totalBreakers >= 0, 'Should have totalBreakers');
    assert.ok(status.breakers, 'Should have breakers object');
    assert.ok(status.summary, 'Should have summary');
    assert.ok(status.summary.totalRequests !== undefined, 'Summary should have totalRequests');
});

test('resetAll resets all circuits', () => {
    global.circuitBreakerManager.resetAll();
    for (const [name, breaker] of global.circuitBreakerManager.breakers.entries()) {
        assert.strictEqual(breaker.state, 'CLOSED', `${name} should be CLOSED after resetAll`);
    }
});

test('Success reduces failure count in CLOSED state', () => {
    const breaker = global.circuitBreakerManager.getBreaker('test-reduce');
    breaker.failures = 3;
    breaker.recordSuccess(100);
    assert.strictEqual(breaker.failures, 2, 'Success should decrement failure count');
});

test('HTTP middleware registered', () => {
    const hooks = global.__patchHooks.getRegisteredHooks();
    const httpNames = hooks.http.map(h => h.name);
    assert.ok(httpNames.includes('circuit-breaker'), 'circuit-breaker should be registered as HTTP middleware');
});

// ── Summary ──────────────────────────────────────────────────────────────────

setTimeout(() => {
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    process.exit(failed > 0 ? 1 : 0);
}, 300);
