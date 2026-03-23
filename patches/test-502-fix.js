#!/usr/bin/env node
/**
 * Test script to verify Antigravity 502 fix is applied
 * Run: node test-502-fix.js
 */

const fs = require('fs');
const path = require('path');

const OMNI_PATHS = [
  process.env.HOME + '/.npm-global/lib/node_modules/omniroute',
  process.env.HOME + '/.omniroute/node_modules/omniroute',
  '/home/openclaw/.npm-global/lib/node_modules/omniroute',
  '/mnt/data/openclaw/home-symlinks/npm-global/lib/node_modules/omniroute',
];

function findOmniRoute() {
  for (const p of OMNI_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function testFix() {
  const omniPath = findOmniRoute();
  if (!omniPath) {
    console.error('[TEST] ERROR: OmniRoute not found');
    process.exit(1);
  }

  const chatCorePath = path.join(omniPath, 'app/open-sse/handlers/chatCore.ts');
  if (!fs.existsSync(chatCorePath)) {
    console.error('[TEST] ERROR: chatCore.ts not found');
    process.exit(1);
  }

  const content = fs.readFileSync(chatCorePath, 'utf-8');

  const tests = [
    {
      name: 'BAD_GATEWAY in token refresh condition',
      check: () => content.includes('HTTP_STATUS.BAD_GATEWAY'),
    },
    {
      name: 'Token refresh runs on 502 errors',
      check: () => /providerResponse\.status === HTTP_STATUS\.BAD_GATEWAY/.test(content),
    },
    {
      name: 'Status code in refresh log message',
      check: () => content.includes('refreshed (${providerResponse.status})'),
    },
    {
      name: 'Status code in refresh failed log',
      check: () => content.includes('refresh failed (${providerResponse.status})'),
    },
    {
      name: 'Handles retry after refresh failure',
      check: () => content.includes("refresh didn't help"),
    },
  ];

  console.log(`[TEST] Checking OmniRoute at: ${omniPath}\n`);
  
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = test.check();
      if (result) {
        console.log(`✅ PASS: ${test.name}`);
        passed++;
      } else {
        console.log(`❌ FAIL: ${test.name}`);
        failed++;
      }
    } catch (e) {
      console.log(`❌ ERROR: ${test.name} - ${e.message}`);
      failed++;
    }
  }

  console.log(`\n[TEST] Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.log('\n[TEST] Fix not applied! Run the apply script:');
    console.log('  bash ~/.omniroute/patches/apply-502-fix.sh');
    process.exit(1);
  }

  console.log('\n[TEST] ✅ All tests passed! 502 fix is properly applied.');
  process.exit(0);
}

testFix();
