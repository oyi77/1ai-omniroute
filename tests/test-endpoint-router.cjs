/**
 * Test: Endpoint Router
 * ======================
 * Tests URL alias rewriting for all endpoint mappings.
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

console.log('\n🧪 Test: Endpoint Router\n');

// Load hooks first, then the endpoint router patch
require('../patches/000-patch-hooks.cjs');
require('../patches/endpoint-router.cjs');

// ── Tests ────────────────────────────────────────────────────────────────────

const ALIAS_TEST_CASES = [
    // Image aliases
    ['/v1/dalle', '/v1/images/generations'],
    ['/v1/stable-diffusion', '/v1/images/generations'],
    ['/v1/flux', '/v1/images/generations'],
    ['/v1/midjourney', '/v1/images/generations'],
    // Video aliases
    ['/v1/sora', '/v1/videos/generations'],
    ['/v1/seedance', '/v1/videos/generations'],
    ['/v1/kling', '/v1/videos/generations'],
    ['/v1/runway', '/v1/videos/generations'],
    ['/v1/t2v', '/v1/videos/generations'],
    ['/v1/i2v', '/v1/videos/generations'],
    // Vision aliases
    ['/v1/vision', '/v1/chat/completions'],
    ['/v1/analyze', '/v1/chat/completions'],
    ['/v1/ocr', '/v1/chat/completions'],
    // Audio aliases
    ['/v1/transcribe', '/v1/audio/transcriptions'],
    ['/v1/speech', '/v1/audio/speech'],
    ['/v1/tts', '/v1/audio/speech'],
    ['/v1/whisper', '/v1/audio/transcriptions'],
    // Embeddings
    ['/v1/embed', '/v1/embeddings'],
    ['/v1/vectorize', '/v1/embeddings'],
    // Reranking
    ['/v1/rank', '/v1/rerank'],
    // Moderation
    ['/v1/moderate', '/v1/moderations'],
    // Music
    ['/v1/music', '/v1/music/generations'],
];

// Create a test server that echoes the URL it received
for (const [alias, expectedTarget] of ALIAS_TEST_CASES) {
    asyncTest(`${alias} → ${expectedTarget}`, async () => {
        const server = http.createServer((req, res) => {
            // This is the final handler — req.url should be the rewritten URL
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ url: req.url }));
        });

        await new Promise((resolve, reject) => {
            server.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                const req = http.request({ hostname: '127.0.0.1', port, path: alias, method: 'GET' }, (res) => {
                    let data = '';
                    res.on('data', c => data += c);
                    res.on('end', () => {
                        server.close();
                        try {
                            const parsed = JSON.parse(data);
                            assert.strictEqual(parsed.url, expectedTarget,
                                `Expected ${alias} to rewrite to ${expectedTarget}, got ${parsed.url}`);
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
}

// Test that non-aliased URLs pass through unchanged
asyncTest('/v1/chat/completions passes through unchanged', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: req.url }));
    });

    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const req = http.request({ hostname: '127.0.0.1', port, path: '/v1/chat/completions', method: 'POST' }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    server.close();
                    try {
                        const parsed = JSON.parse(data);
                        assert.strictEqual(parsed.url, '/v1/chat/completions');
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

asyncTest('Random URL /some/path passes through unchanged', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: req.url }));
    });

    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const port = server.address().port;
            const req = http.request({ hostname: '127.0.0.1', port, path: '/some/path', method: 'GET' }, (res) => {
                let data = '';
                res.on('data', c => data += c);
                res.on('end', () => {
                    server.close();
                    try {
                        const parsed = JSON.parse(data);
                        assert.strictEqual(parsed.url, '/some/path');
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
}, 2000);
