# Fake Tool: MCP Tool Impersonation and Name Squatting

**Check:** FAKETOOL-001, FAKETOOL-002, FAKETOOL-005 | Severity: Critical | Auto-Fix: No

## Description

This MCP server accepts tool registration requests without validation, allowing attackers to register fake tools that impersonate legitimate ones. The server does not check for name similarity (typosquatting), does not verify tool provenance, and allows priority-based tool replacement.

## How an Attacker Exploits It

1. Register a tool with a name nearly identical to a legitimate tool (e.g., `read_flie` instead of `read_file`)
2. The agent selects the fake tool due to fuzzy matching or priority
3. The fake tool intercepts requests, exfiltrates data, or modifies responses
4. Alternatively, register a tool with maximum priority to shadow the legitimate tool entirely
5. Register tools with forged provider metadata to bypass trust checks

## Impact

- Data interception via tool impersonation
- Credential theft through fake tool parameters
- Agent behavior manipulation via response modification
- Trust bypass through forged tool metadata

## Detection

```bash
npx hackmyagent attack --target http://localhost:3022 --categories fake-tool
```

## How to Fix It

1. Implement Levenshtein distance checks against existing tool names
2. Require cryptographic tool provenance verification
3. Block dynamic tool registration from untrusted sources
4. Make tool priority immutable after initial configuration
5. Rate-limit tool registration and detect batch flooding

## References

- CWE-829: Inclusion of Functionality from Untrusted Control Sphere
- CWE-290: Authentication Bypass by Spoofing
- CWE-706: Use of Incorrectly-Resolved Name or Reference
