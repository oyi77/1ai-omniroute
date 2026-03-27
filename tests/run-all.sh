#!/bin/bash
# Run all OmniRoute patch tests
# ==============================

set -e

TESTS_DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL_PASS=0
TOTAL_FAIL=0
RESULTS=""

run_test() {
  local test_file="$1"
  local test_name="$(basename "$test_file" .cjs)"
  
  echo ""
  echo "═══════════════════════════════════════════════════"
  echo "  Running: $test_name"
  echo "═══════════════════════════════════════════════════"
  
  if node "$test_file" 2>&1; then
    RESULTS="$RESULTS\n  ✅ $test_name"
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    RESULTS="$RESULTS\n  ❌ $test_name (EXIT CODE: $?)"
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
  fi
}

echo "🧪 OmniRoute Patch Test Suite"
echo "=============================="

# Run tests in dependency order
run_test "$TESTS_DIR/test-patch-hooks.cjs"
run_test "$TESTS_DIR/test-endpoint-router.cjs"
run_test "$TESTS_DIR/test-response-cache.cjs"
run_test "$TESTS_DIR/test-circuit-breaker.cjs"
run_test "$TESTS_DIR/test-max-tokens-guard.cjs"
run_test "$TESTS_DIR/test-integration.cjs"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  SUMMARY"
echo "═══════════════════════════════════════════════════"
echo -e "$RESULTS"
echo ""
echo "📊 Total: $((TOTAL_PASS + TOTAL_FAIL)) suites, $TOTAL_PASS passed, $TOTAL_FAIL failed"
echo ""

if [ "$TOTAL_FAIL" -gt 0 ]; then
  echo "❌ SOME TESTS FAILED"
  exit 1
else
  echo "✅ ALL TESTS PASSED"
  exit 0
fi
