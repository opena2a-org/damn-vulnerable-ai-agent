# MCP Discovery Endpoint Exposed

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No (manual)

A .well-known/mcp.json file makes MCP servers publicly discoverable. Attackers can enumerate available servers and their transport endpoints.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Remove .well-known/mcp.json from public directories or restrict access via web server config.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services

## Detection status

No check detects this fixture as of HackMyAgent 0.33.2 (static scan). `MCP-011` detected it in HackMyAgent 0.11.15; in 0.33.2 the check still exists but does not fire on `.well-known/mcp.json`.

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
