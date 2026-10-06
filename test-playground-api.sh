#!/usr/bin/env bash
# Smoke test for the playground API served by the DVAA dashboard.
#
# Usage: ./test-playground-api.sh [base-url]   (default: http://localhost:9000)
# Requires curl and jq. No LLM key is sent, so the playground uses its built-in
# simulator, not a real LLM.
# Exit status: 0 when every endpoint answers HTTP 200 with "success": true,
# 1 when any check fails, 2 when jq is missing.

set -uo pipefail

BASE_URL="${1:-http://localhost:9000}"
FAILED=0

command -v jq > /dev/null || { echo "jq is required: https://jqlang.org/download/" >&2; exit 2; }

# check <label> <curl args...>: the response must be HTTP 200 with "success": true.
check() {
  local label="$1"
  shift
  local response status body
  if ! response=$(curl -sS --max-time 30 -w '\n%{http_code}' "$@" 2>&1); then
    echo "FAIL: $label: no response (${response##*$'\n'})"
    FAILED=1
    return
  fi
  status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if [ "$status" = "200" ] && printf '%s' "$body" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "ok: $label"
  else
    echo "FAIL: $label: HTTP $status: $(printf '%s' "$body" | head -c 200)"
    FAILED=1
  fi
}

echo "Testing the playground API at $BASE_URL"
check "GET /playground/library" "$BASE_URL/playground/library"
check "GET /playground/library/insecure-basic" "$BASE_URL/playground/library/insecure-basic"
check "POST /playground/test" -X POST "$BASE_URL/playground/test" \
  -H "Content-Type: application/json" \
  -d '{"systemPrompt":"You are helpful.","intensity":"passive"}'
check "POST /playground/apply-recommendations" -X POST "$BASE_URL/playground/apply-recommendations" \
  -H "Content-Type: application/json" \
  -d '{"systemPrompt":"You are helpful.","recommendations":[]}'

if [ "$FAILED" -ne 0 ]; then
  echo "Playground API check failed."
  exit 1
fi
echo "All playground API checks passed."
