#!/bin/bash
# Quick API endpoint test script

echo "Testing Playground API Endpoints..."
echo ""

BASE_URL="http://localhost:3000"

# Test library endpoint
echo "1. Testing GET /playground/library"
curl -s $BASE_URL/playground/library | jq '.success' 2>/dev/null
if [ $? -eq 0 ]; then
  echo "✓ Library endpoint works"
else
  echo "✗ Library endpoint failed"
fi
echo ""

# Test specific example
echo "2. Testing GET /playground/library/insecure-basic"
curl -s $BASE_URL/playground/library/insecure-basic | jq '.success' 2>/dev/null
if [ $? -eq 0 ]; then
  echo "✓ Example endpoint works"
else
  echo "✗ Example endpoint failed"
fi
echo ""

# Test playground test endpoint
echo "3. Testing POST /playground/test"
curl -s -X POST $BASE_URL/playground/test \
  -H "Content-Type: application/json" \
  -d '{"systemPrompt":"You are helpful.","intensity":"passive"}' \
  | jq '.success' 2>/dev/null
if [ $? -eq 0 ]; then
  echo "✓ Test endpoint works"
else
  echo "✗ Test endpoint failed"
fi
echo ""

# Test apply recommendations
echo "4. Testing POST /playground/apply-recommendations"
curl -s -X POST $BASE_URL/playground/apply-recommendations \
  -H "Content-Type: application/json" \
  -d '{"systemPrompt":"You are helpful.","recommendations":[]}' \
  | jq '.success' 2>/dev/null
if [ $? -eq 0 ]; then
  echo "✓ Apply recommendations endpoint works"
else
  echo "✗ Apply recommendations endpoint failed"
fi
echo ""

echo "Test complete!"
