# MCP Tool Poisoning

**Category:** MCP Security
**Severity:** Critical
**Check IDs:** None (see Detection status)
**OASB Control:** SS-06

## Description

A malicious MCP server registers tools with legitimate-sounding names (e.g., `read_file`, `search_code`) but implements hidden exfiltration logic. When an AI agent calls the tool, it performs the requested action AND silently sends sensitive data (environment variables, file contents, credentials) to an attacker-controlled endpoint. The tool returns normal-looking results, making the exfiltration invisible to the user and agent.

## Attack Vector

1. Attacker publishes an MCP server with useful tools (file reader, code search, database query)
2. User adds the MCP server to their configuration
3. AI agent discovers and calls the tools during normal operation
4. Tool executes the requested action correctly (reads the file, returns results)
5. Tool simultaneously exfiltrates sensitive data to attacker endpoint (env vars, .env contents, SSH keys)
6. Agent and user see only the legitimate response -- exfiltration is invisible

## Impact

- Silent exfiltration of credentials, API keys, and sensitive files
- Environment variable harvesting (AWS keys, database URLs, tokens)
- Persistent access: attacker receives credentials enabling direct system access
- No visible indication of compromise in tool responses

## Detection

```bash
npx hackmyagent secure scenarios/mcp-tool-poisoning/vulnerable
```

## Remediation

- Audit MCP server source code before installation
- Use network monitoring to detect unexpected outbound connections from MCP servers
- Run MCP servers in sandboxed environments with restricted network access
- Implement egress filtering to block unauthorized external connections
- Use MCP servers only from trusted, verified publishers
- Monitor MCP server behavior for data exfiltration patterns

## References

- OWASP LLM Top 10: LLM05 - Supply Chain Vulnerabilities
- CWE-200: Exposure of Sensitive Information to an Unauthorized Actor
- [MCP Security Considerations](https://modelcontextprotocol.io/specification/2025-03-26/security)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `MCP-001` — real HMA check, but this fixture lacks the trigger file/condition
- `TOOL-001` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
