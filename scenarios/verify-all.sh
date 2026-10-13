#!/usr/bin/env bash
# DVAA scenario verification harness.
#
# For every scenario with expected checks (scenarios/<name>/expected-checks.json):
#   1. copy vulnerable/ to a temporary directory;
#   2. scan the copy: every expected check must fire;
#   3. if any expected check is auto-fixable, run --fix on the copy, re-scan it,
#      and require each fixable expected check to be gone;
#   4. remove the copy. HackMyAgent only receives the copy, so the shipped
#      fixture is not modified.
#
# A scenario whose expected-checks.json is [] is reported as "no expectations"
# and is not counted as passed. A scenario with expectations but no
# vulnerable/ directory fails.
#
# Scans use the same flags as the dashboard and `dvaa scan`
# (src/dashboard/scanner.js): results stay on this machine, static checks only.
#
# Usage: scenarios/verify-all.sh [scenario-name]
#   HMA_CLI  HackMyAgent command to run (default: this package's
#            node_modules/.bin/hackmyagent, installed by `npm ci`)
# Exit status: 0 when every scenario with expectations passes, 1 when any
# fails, 2 on a usage or setup error.

set -euo pipefail

SCENARIOS_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_ROOT="$(dirname "$SCENARIOS_DIR")"
HMA_FLAGS=(--format json --no-color --no-registry --no-contribute --static-only --no-machine-posture)

if [ -n "${HMA_CLI:-}" ]; then
  read -r -a HMA_CMD <<< "$HMA_CLI"
else
  HMA_CMD=("$PKG_ROOT/node_modules/.bin/hackmyagent")
  if [ ! -x "${HMA_CMD[0]}" ]; then
    echo "HackMyAgent not found at ${HMA_CMD[0]}." >&2
    echo "Run: npm ci  (in $PKG_ROOT), or set HMA_CLI to a hackmyagent command." >&2
    exit 2
  fi
fi

# Reads a HackMyAgent JSON report on stdin and prints "<checkId> <fixable>"
# for each check that failed. Exits 3 if stdin is not a JSON report.
parse_report() {
  node -e '
    let s = "";
    process.stdin.on("data", d => { s += d; }).on("end", () => {
      let report;
      try { report = JSON.parse(s); } catch { process.exit(3); }
      const ids = new Map();
      for (const f of report.findings || []) {
        if (!f || f.passed !== false || !f.checkId) continue;
        ids.set(f.checkId, ids.get(f.checkId) || f.fixable === true);
      }
      for (const [id, fixable] of ids) console.log(id + " " + fixable);
    });'
}

# scan <dir> <out-file> [extra HackMyAgent flags]: writes parse_report output.
# HackMyAgent exits 1 when it finds critical or high issues; the report decides.
scan() {
  local dir="$1" out="$2"
  shift 2
  "${HMA_CMD[@]}" secure "$dir" "${HMA_FLAGS[@]}" "$@" > "$out.json" 2>/dev/null || true
  parse_report < "$out.json" > "$out"
}

fires() { grep -q "^$1 " "$2"; }

# Runs in a subshell so the EXIT trap removes the temporary copy.
# Returns 0 pass, 1 fail, 3 no expectations.
verify_scenario() (
  name="$1"
  dir="$SCENARIOS_DIR/$name"
  expected=$(node -e 'const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (!Array.isArray(a)) process.exit(1); console.log(a.join(" "))' "$dir/expected-checks.json") || {
    echo "  FAIL: expected-checks.json is not a JSON array"
    return 1
  }
  if [ -z "$expected" ]; then
    echo "  no expectations (expected-checks.json is [])"
    return 3
  fi
  if [ ! -d "$dir/vulnerable" ]; then
    echo "  FAIL: no vulnerable/ directory (expects $expected)"
    return 1
  fi

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  mkdir "$tmp/copy"
  cp -R "$dir/vulnerable/." "$tmp/copy/"

  echo "  [1/3] Detect"
  if ! scan "$tmp/copy" "$tmp/baseline"; then
    echo "  FAIL: HackMyAgent did not return a JSON report"
    return 1
  fi
  detected=true
  fixable=()
  for id in $expected; do
    if fires "$id" "$tmp/baseline"; then
      echo "    $id detected"
      if grep -q "^$id true$" "$tmp/baseline"; then fixable+=("$id"); fi
    else
      echo "    $id NOT DETECTED"
      detected=false
    fi
  done
  if [ "$detected" = false ]; then
    echo "  FAIL: detection incomplete"
    return 1
  fi

  if [ "${#fixable[@]}" -eq 0 ]; then
    echo "  [2/3] Fix: no expected check is auto-fixable"
    echo "  PASS (detected)"
    return 0
  fi

  echo "  [2/3] Fix (${fixable[*]})"
  "${HMA_CMD[@]}" secure "$tmp/copy" "${HMA_FLAGS[@]}" --fix > /dev/null 2>&1 || true

  echo "  [3/3] Re-scan the fixed copy"
  if ! scan "$tmp/copy" "$tmp/after"; then
    echo "  FAIL: HackMyAgent did not return a JSON report after --fix"
    return 1
  fi
  fixed=true
  for id in "${fixable[@]}"; do
    if fires "$id" "$tmp/after"; then
      echo "    $id STILL FIRING after --fix"
      fixed=false
    else
      echo "    $id fixed"
    fi
  done
  if [ "$fixed" = false ]; then
    echo "  FAIL: fix verification failed"
    return 1
  fi
  echo "  PASS (detected, fixed, confirmed by re-scan)"
  return 0
)

target="${1:-}"
if [ -n "$target" ] && [ ! -f "$SCENARIOS_DIR/$target/expected-checks.json" ]; then
  echo "No scenario named '$target' in $SCENARIOS_DIR" >&2
  exit 2
fi

echo "DVAA scenario verification"
echo "HackMyAgent: $("${HMA_CMD[@]}" --version 2>/dev/null | head -1)"
echo

PASSED=0
FAILED=0
NO_EXPECTATIONS=0
FAILED_NAMES=()
for scenario_dir in "$SCENARIOS_DIR"/*/; do
  name=$(basename "$scenario_dir")
  [ "$name" = "examples" ] && continue
  [ -f "$scenario_dir/expected-checks.json" ] || continue
  if [ -n "$target" ] && [ "$target" != "$name" ]; then continue; fi

  echo "[$name]"
  rc=0
  verify_scenario "$name" || rc=$?
  case "$rc" in
    0) PASSED=$((PASSED + 1)) ;;
    3) NO_EXPECTATIONS=$((NO_EXPECTATIONS + 1)) ;;
    *) FAILED=$((FAILED + 1)); FAILED_NAMES+=("$name") ;;
  esac
  echo
done

echo "Results: $PASSED passed, $FAILED failed, $NO_EXPECTATIONS with no expectations ($((PASSED + FAILED + NO_EXPECTATIONS)) scenarios)"
if [ "$FAILED" -gt 0 ]; then
  echo
  echo "Failed scenarios:"
  for name in "${FAILED_NAMES[@]}"; do echo "  - $name"; done
  exit 1
fi
