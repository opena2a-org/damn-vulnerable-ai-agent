# Typosquatting MCP Server

**Category:** Supply Chain
**Severity:** High
**Check IDs:** None (see Detection status)
**OASB Control:** 8.3

## Description

An MCP configuration file references `@modelcontextprotocol/server-filesytem` -- a typosquatted package name missing the 's' in "filesystem". The legitimate package is `@modelcontextprotocol/server-filesystem`. An attacker who registers the typosquatted name can intercept all file system operations, exfiltrate data, or inject malicious tool responses.

## Attack Vector

1. Attacker identifies common MCP server package names
2. Attacker registers near-miss typos on npm (e.g., `filesytem`, `filesystm`, `fillesystem`)
3. The typosquatted package mimics the real one's API but includes malicious hooks
4. When a developer copies the config with a typo (or an LLM hallucinates the wrong name), the malicious package is installed
5. All MCP tool calls route through the attacker's code

## Impact

- Full interception of file read/write operations
- Exfiltration of sensitive files accessed by the agent
- Injection of malicious content into tool responses
- Modification of files written by the agent

## Detection

```bash
npx hackmyagent secure scenarios/typosquatting-mcp/vulnerable
```

## Remediation

- Verify package names against official documentation before adding to configs
- Use lockfiles with integrity hashes to detect unexpected package changes
- Implement allowlists for permitted MCP server packages
- Use `npm audit` to check for known typosquatting packages
- Configure package manager to warn on first-time installs of new packages

## References

- OWASP LLM Top 10: LLM05 - Supply Chain Vulnerabilities
- CWE-1104: Use of Unmaintained Third-Party Components

**References:**
- [CWE-1321: Improperly Controlled Modification of Object Prototype Attributes](https://cwe.mitre.org/data/definitions/1321.html)
- [Socket.dev — Typosquatting and Supply Chain Attacks](https://socket.dev/blog/typosquatting)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `SUPPLY-001` — real HMA check (fires on other fixtures); this fixture does not trigger it
- `MCP-002` — real HMA check, but this fixture lacks the trigger file/condition

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
