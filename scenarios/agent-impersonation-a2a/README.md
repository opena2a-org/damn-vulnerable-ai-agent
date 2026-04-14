# Agent Impersonation via A2A

**Category:** Multi-Agent
**Severity:** Critical
**Check IDs:** None (see Detection status)
**OASB Control:** 7.1

## Description

An A2A agent accepts and executes messages from any sender without verifying identity. The `agent.json` declares no authentication requirements, and the worker blindly trusts the `from` field in incoming messages. An attacker can impersonate a trusted orchestrator or admin agent to delegate arbitrary tasks including data access, code execution, and privilege escalation.

## Attack Vector

1. Attacker discovers the agent's endpoint (publicly accessible or via A2A discovery)
2. The `agent.json` specifies no authentication scheme
3. Attacker sends a message with `"from": "admin-orchestrator"` -- a trusted agent name
4. The worker checks `msg.from` to determine trust level but never verifies the claim
5. The forged identity grants the attacker elevated permissions
6. The worker executes privileged operations on behalf of the "admin" agent

## Impact

- Unauthorized task execution with elevated privileges
- Data exfiltration through delegated data access tasks
- Lateral movement across the agent network
- Complete compromise of multi-agent trust model

## Detection

```bash
npx hackmyagent secure scenarios/agent-impersonation-a2a/vulnerable
```

## Remediation

- Require mutual TLS or API key authentication for all A2A communication
- Declare authentication requirements in `agent.json` security section
- Verify sender identity cryptographically (signed messages, JWT, mTLS certificates)
- Implement an agent registry with identity verification
- Never trust self-declared identity (`from` field) without verification
- Use capability-based access control instead of identity-based trust

## References

- OWASP LLM Top 10: LLM08 - Excessive Agency
- CWE-287: Improper Authentication

**References:**
- [CWE-287: Improper Authentication](https://cwe.mitre.org/data/definitions/287.html)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `AUTH-001` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
