# MCP Discovery Endpoint Exposed

**Check:** MCP-011 | **Severity:** High | **Auto-Fix:** No (manual)

A .well-known/mcp.json file makes MCP servers publicly discoverable. Attackers can enumerate available servers and their transport endpoints.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Remove .well-known/mcp.json from public directories or restrict access via web server config.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
