# MCP Discovery Endpoint Exposed

**Check:** MCP-011 | **Severity:** High | **Auto-Fix:** No (manual)

A .well-known/mcp.json file makes MCP servers publicly discoverable. Attackers can enumerate available servers and their transport endpoints.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Remove .well-known/mcp.json from public directories or restrict access via web server config.
