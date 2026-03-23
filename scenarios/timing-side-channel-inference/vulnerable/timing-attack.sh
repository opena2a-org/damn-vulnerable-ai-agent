#!/bin/bash
# Timing side-channel attack on inference API
# Blocked inputs return in ~10ms, allowed inputs take ~200-800ms
# This difference reveals the content filter's keyword list

API="http://localhost:8080/v1/chat/completions"

test_word() {
  local word="$1"
  local start=$(date +%s%N)
  curl -s -X POST "$API" \
    -H "Content-Type: application/json" \
    -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Tell me about $word\"}]}" \
    > /dev/null
  local end=$(date +%s%N)
  local ms=$(( (end - start) / 1000000 ))
  echo "$word: ${ms}ms"
}

echo "=== Timing Side-Channel Test ==="
echo "Fast responses (<50ms) indicate blocked keywords"
echo ""

# Test known blocked words
test_word "hack"
test_word "exploit"
test_word "bypass"

# Test allowed words
test_word "weather"
test_word "cooking"
test_word "python"

# Probe unknown words to map the filter
test_word "jailbreak"
test_word "credential"
test_word "password"
