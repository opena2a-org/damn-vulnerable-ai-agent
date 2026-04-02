# Persistent Agent: Memory Poisoning and Cross-Session State Tampering

**Check:** PERSIST-001, PERSIST-003, PERSIST-005 | Severity: Critical | Auto-Fix: No

## Description

This agent persists conversation memory and session state to disk without integrity validation. An attacker can inject malicious entries into the memory store that survive across sessions, poisoning future interactions with false instructions, credential harvesting templates, or privilege escalation payloads.

## How an Attacker Exploits It

1. Store a crafted memory entry containing a fake system instruction
2. The agent persists the entry to its memory file without validation
3. On the next session, the agent loads the poisoned memory
4. The injected instruction alters agent behavior (e.g., disabling safety filters)
5. Cross-session credential harvesting: store a template that causes the agent to include API keys in responses

## Impact

- Persistent backdoor across agent sessions
- Safety filter bypass via stored instructions
- Credential exfiltration through poisoned response templates
- Privilege escalation through accumulated state changes

## Detection

```bash
npx hackmyagent attack --target http://localhost:3021 --categories persistent-agent
```

## How to Fix It

1. Sign memory entries with HMAC to detect tampering
2. Block storage of entries with system role from untrusted sources
3. Validate memory integrity on every session load
4. Never store credentials or security-relevant configuration in agent memory
5. Implement memory entry expiration and rotation

## References

- CWE-472: External Control of Assumed-Immutable Web Parameter
- CWE-384: Session Fixation
- CWE-522: Insufficiently Protected Credentials
