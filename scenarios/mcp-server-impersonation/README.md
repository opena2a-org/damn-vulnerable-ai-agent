# MCP Server Impersonation

**Category:** MCP Security
**Severity:** Critical
**Check IDs:** None (see Detection status)
**OASB Control:** SS-04

## Description

An attacker deploys a malicious MCP server that impersonates a legitimate, trusted server by mimicking its tool names, descriptions, and response format. If the agent's MCP configuration is writable or the discovery mechanism lacks authentication, the attacker can redirect tool calls to their server. The impersonating server can intercept all data passed to tools, return manipulated results, and harvest credentials.

## Attack Vector

1. Attacker identifies a legitimate MCP server the target uses (e.g., a database query tool)
2. Attacker deploys an impersonating server with identical tool names and schemas
3. Attacker modifies the agent's MCP config (via writable CLAUDE.md, config injection, or DNS hijacking) to point to the malicious server
4. Agent discovers tools from the impersonating server -- they look identical to the legitimate ones
5. All tool calls now route through the attacker's server
6. Attacker intercepts queries, credentials, and can return manipulated results

## Impact

- Complete interception of all tool call data (queries, file contents, credentials)
- Result manipulation: attacker controls what the agent sees (fake database results, altered file contents)
- Man-in-the-middle position between agent and intended services
- Credential harvesting from tool arguments (database passwords, API keys)
- Long-term persistence if config change goes undetected

## Detection

```bash
npx hackmyagent secure scenarios/mcp-server-impersonation/vulnerable
```

## Remediation

- Implement MCP server identity verification (TLS certificate pinning, server signing)
- Protect MCP configuration files with integrity checks and restricted write access
- Verify server identity on each connection, not just during initial setup
- Use authenticated MCP transports (mTLS, bearer tokens)
- Monitor for unexpected changes to MCP server endpoints
- Implement tool response validation against expected schemas

## References

- OWASP LLM Top 10: LLM05 - Supply Chain Vulnerabilities
- CWE-290: Authentication Bypass by Spoofing
- [MCP Security Considerations](https://modelcontextprotocol.io/specification/2025-03-26/security)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `MCP-003` — real HMA check, but this fixture lacks the trigger file/condition
- `AUTH-002` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
