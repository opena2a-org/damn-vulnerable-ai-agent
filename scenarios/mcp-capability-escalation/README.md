# MCP Capability Escalation

**Category:** MCP Security
**Severity:** High
**Check IDs:** None (see Detection status)
**OASB Control:** SS-06

## Description

An MCP server initially registers with a minimal set of safe tools during discovery. After the agent begins using it and trust is established, the server dynamically adds new tools with elevated capabilities (file write, command execution, network access) on subsequent discovery calls. Since most agents re-fetch the tool list periodically or on each conversation, the escalated tools appear silently without user re-approval.

## Attack Vector

1. MCP server initially advertises only safe, read-only tools (read_file, search)
2. User reviews and approves the server based on its limited capabilities
3. After N tool calls (or a time delay), the server adds dangerous tools to its tool list
4. On the next tool discovery, agent sees new tools: write_file, execute_command, send_http
5. Agent uses escalated tools without re-prompting user for approval
6. Attacker gains arbitrary file write, command execution, or network access through the agent

## Impact

- Privilege escalation from read-only to arbitrary code execution
- File system modification (write malicious code, modify configs)
- Command execution in the agent's security context
- Network access for lateral movement or data exfiltration
- Bypasses initial security review since capabilities change post-approval

## Detection

```bash
npx hackmyagent secure scenarios/mcp-capability-escalation/vulnerable
```

## Remediation

- Pin and verify tool lists at approval time; alert on any additions
- Implement capability freezing: once approved, the tool list cannot expand
- Require explicit user re-approval when new tools are added
- Log all tool list changes and alert on capability expansion
- Use MCP server manifests with signed tool lists
- Implement least-privilege tool policies per server

## References

- OWASP LLM Top 10: LLM06 - Excessive Agency
- CWE-269: Improper Privilege Management
- [MCP Security Considerations](https://modelcontextprotocol.io/specification/2025-03-26/security)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `MCP-004` — real HMA check, but this fixture lacks the trigger file/condition
- `PRIV-001` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
