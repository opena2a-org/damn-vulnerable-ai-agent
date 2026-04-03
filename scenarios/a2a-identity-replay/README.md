# A2A Identity Replay Attack

**Category:** A2A Security
**Severity:** Critical
**Check IDs:** A2A-010, AUTH-003
**OASB Control:** SS-04

## Description

An A2A agent uses static identity tokens (API keys, bearer tokens, or agent IDs) for authentication that don't expire and aren't bound to a specific session or timestamp. An attacker captures a legitimate agent's identity token from network traffic, logs, or a compromised agent, then replays it to impersonate the legitimate agent. The lack of token expiry, nonce, or session binding means captured tokens are valid indefinitely.

## Attack Vector

1. Legitimate agents authenticate using static bearer tokens in HTTP headers
2. Attacker captures a token through: network sniffing (HTTP, not HTTPS), log file access, or a compromised intermediate agent
3. Attacker replays the captured token in requests to other agents or the coordinator
4. Receiving agents validate the token against a static allowlist -- it matches
5. Attacker now operates with the legitimate agent's full identity and permissions
6. Attack persists until the token is manually rotated (which may never happen)

## Impact

- Full identity takeover of the compromised agent
- Access to all resources and tasks the legitimate agent is authorized for
- Undetectable: replayed token is identical to the legitimate one
- Persistent: static tokens don't expire, so the attack window is indefinite
- Lateral movement: captured high-privilege token grants access across the agent network
- Audit trail contamination: malicious actions attributed to the legitimate agent

## Detection

```bash
npx hackmyagent secure scenarios/a2a-identity-replay/vulnerable
```

## Remediation

- Use time-bound tokens (JWT with short expiry) instead of static API keys
- Implement nonce-based authentication to prevent replay
- Bind tokens to session context (source IP, TLS session, agent fingerprint)
- Use mutual TLS (mTLS) for agent-to-agent authentication
- Implement token rotation policies with automatic expiry
- Monitor for concurrent use of the same token from different sources
- Log and alert on authentication from unexpected network locations

## References

- OWASP LLM Top 10: LLM08 - Excessive Agency
- CWE-294: Authentication Bypass by Capture-replay
- CWE-613: Insufficient Session Expiration
- [A2A Protocol Security](https://google.github.io/A2A/)
