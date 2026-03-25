# Prompt Injection to Lateral Movement via MCP Server Hopping

**Category:** Multi-Step Attack Chain
**Severity:** Critical
**Check IDs:** PROMPT-002, MCP-002, MCP-011, INJ-003
**ATM Techniques:** T-2001, T-1002, T-5003, T-4003

## Description

A prompt injection payload embedded in an MCP server's tool response causes the consuming agent to enumerate other MCP servers on the local network, connect to them using discovered credentials from the original server's configuration, and inject malicious parameters into their tool calls. This chain demonstrates how a single prompt injection can cascade into full lateral movement across an MCP server fleet.

## Attack Chain

1. **T-2001 (Prompt Injection):** An MCP server returns a tool response containing an embedded prompt injection payload. The payload instructs the agent to "update its MCP configuration" by executing a discovery sequence.

2. **T-1002 (Tool Discovery):** The injected instructions cause the agent to call the `list_servers` tool, which reads the MCP configuration file (`mcp.json`) and enumerates all configured MCP server endpoints along with their connection credentials.

3. **T-5003 (MCP Server Hopping):** Using the discovered server endpoints and credentials, the agent connects to neighboring MCP servers. The `connect_server` tool makes unauthenticated connections to any endpoint, with no allowlist or mutual authentication.

4. **T-4003 (Tool Parameter Injection):** Once connected to a neighboring server, the agent calls tools with injected parameters. For example, calling a database query tool with `'; DROP TABLE users; --` or a file write tool with a webshell payload.

## Impact

- Single prompt injection compromises the entire MCP server fleet
- Credential leakage from MCP configuration files
- Arbitrary tool execution on neighboring servers
- SQL injection, file write, and code execution on lateral targets
- Difficult to attribute -- the attacking agent appears to be making legitimate tool calls

## Detection

```bash
npx hackmyagent secure scenarios/prompt-to-lateral-movement/vulnerable
```

## Remediation

- Sanitize all tool responses before feeding them back to the LLM context
- Implement MCP server authentication (mTLS, bearer tokens) and never store credentials in plaintext config files
- Restrict which MCP servers an agent can connect to via an explicit allowlist
- Validate tool parameters against strict schemas; reject parameters containing SQL or shell metacharacters
- Isolate MCP servers on separate network segments with no lateral connectivity
- Implement tool call audit logging with anomaly detection for unusual cross-server patterns

**References:**
- [CWE-74: Improper Neutralization of Special Elements in Output](https://cwe.mitre.org/data/definitions/74.html)
- [CWE-918: Server-Side Request Forgery](https://cwe.mitre.org/data/definitions/918.html)
- OWASP Top 10 for LLM Applications -- LLM01: Prompt Injection
