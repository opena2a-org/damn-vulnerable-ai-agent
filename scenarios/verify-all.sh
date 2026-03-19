#!/usr/bin/env bash
# DVAA Scenario Verification Harness
#
# For each scenario, runs the full cycle:
#   1. Copy vulnerable/ to temp dir
#   2. HMA scan → assert expected checks FOUND (detection works)
#   3. HMA fix  → assert expected checks FIXED (auto-fix works)
#   4. HMA scan → assert expected checks GONE (fix actually works)
#   5. Clean up
#
# Usage: ./verify-all.sh [scenario-name]
#   Run all scenarios or a specific one.

set -euo pipefail

HMA="${HMA_CLI:-node /Users/ecolibria/workspace/opena2a-org/hackmyagent/dist/cli.js}"
SCENARIOS_DIR="$(cd "$(dirname "$0")" && pwd)"
PASSED=0
FAILED=0
ERRORS=""

verify_scenario() {
  local scenario_name="$1"
  local scenario_dir="$SCENARIOS_DIR/$scenario_name"
  local vuln_dir="$scenario_dir/vulnerable"
  local expected_file="$scenario_dir/expected-checks.json"

  if [ ! -d "$vuln_dir" ] || [ ! -f "$expected_file" ]; then
    echo "  SKIP: Missing vulnerable/ or expected-checks.json"
    return 0
  fi

  # Read expected check IDs
  local expected_checks
  expected_checks=$(cat "$expected_file")

  # Create temp working dir
  local tmp_dir
  tmp_dir=$(mktemp -d)
  trap "rm -rf '$tmp_dir'" RETURN

  # Copy vulnerable files to temp
  cp -r "$vuln_dir"/. "$tmp_dir"/

  echo "  [1/3] Detect..."
  # Step 1: Scan - expected checks should be FOUND
  local scan_output
  scan_output=$($HMA secure "$tmp_dir" --json 2>/dev/null || true)

  local all_detected=true
  for check_id in $(echo "$expected_checks" | tr -d '[]" ' | tr ',' '\n'); do
    if echo "$scan_output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
found = any(f['checkId'] == '$check_id' for f in data.get('findings', []))
sys.exit(0 if found else 1)
" 2>/dev/null; then
      echo "    $check_id detected"
    else
      echo "    $check_id NOT DETECTED"
      all_detected=false
    fi
  done

  if [ "$all_detected" = false ]; then
    echo "  FAIL: Detection incomplete"
    return 1
  fi

  # Check which are fixable
  local fixable_checks
  fixable_checks=$(echo "$scan_output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
checks = [f['checkId'] for f in data.get('findings', []) if f.get('fixable') and not f.get('passed')]
expected = json.loads('$expected_checks')
fixable = [c for c in expected if c in checks]
print(' '.join(fixable))
" 2>/dev/null || echo "")

  if [ -z "$fixable_checks" ]; then
    echo "  [2/3] Fix... (no auto-fixable checks, skipping fix verification)"
    echo "  PASS (detect only)"
    return 0
  fi

  echo "  [2/3] Fix..."
  # Step 2: Fix - run with --fix
  # Re-copy fresh vulnerable files (scan may have been non-destructive but be safe)
  rm -rf "$tmp_dir"/*
  cp -r "$vuln_dir"/. "$tmp_dir"/

  local fix_output
  fix_output=$($HMA secure "$tmp_dir" --fix --json 2>/dev/null || true)

  local all_fixed=true
  for check_id in $fixable_checks; do
    if echo "$fix_output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
fixed = any(f['checkId'] == '$check_id' and f.get('fixed') for f in data.get('findings', []))
sys.exit(0 if fixed else 1)
" 2>/dev/null; then
      echo "    $check_id fixed"
    else
      echo "    $check_id NOT FIXED"
      all_fixed=false
    fi
  done

  if [ "$all_fixed" = false ]; then
    echo "  FAIL: Auto-fix incomplete"
    return 1
  fi

  echo "  [3/3] Verify fix..."
  # Step 3: Re-scan fixed directory - expected checks should be GONE
  local verify_output
  verify_output=$($HMA secure "$tmp_dir" --json 2>/dev/null || true)

  local all_gone=true
  for check_id in $fixable_checks; do
    # Check if the finding still exists AND is not passed
    if echo "$verify_output" | python3 -c "
import json, sys
data = json.load(sys.stdin)
still_failing = any(f['checkId'] == '$check_id' and not f.get('passed') and not f.get('fixed') for f in data.get('findings', []))
sys.exit(1 if still_failing else 0)
" 2>/dev/null; then
      echo "    $check_id gone (fix verified)"
    else
      echo "    $check_id STILL PRESENT (fix did not work)"
      all_gone=false
    fi
  done

  if [ "$all_gone" = false ]; then
    echo "  FAIL: Fix verification failed - issues persist after fix"
    return 1
  fi

  echo "  PASS (detect + fix + verify)"
  return 0
}

# Main
echo "DVAA Scenario Verification"
echo "=========================="
echo ""

# Run specific scenario or all
target="${1:-all}"

for scenario_dir in "$SCENARIOS_DIR"/*/; do
  scenario_name=$(basename "$scenario_dir")

  # Skip if specific scenario requested and this isn't it
  if [ "$target" != "all" ] && [ "$target" != "$scenario_name" ]; then
    continue
  fi

  echo "[$scenario_name]"
  if verify_scenario "$scenario_name"; then
    PASSED=$((PASSED + 1))
  else
    FAILED=$((FAILED + 1))
    ERRORS="$ERRORS  - $scenario_name\n"
  fi
  echo ""
done

echo "=========================="
echo "Results: $PASSED passed, $FAILED failed"

if [ $FAILED -gt 0 ]; then
  echo ""
  echo "Failed scenarios:"
  echo -e "$ERRORS"
  exit 1
fi
