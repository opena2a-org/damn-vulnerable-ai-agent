# A2A Task Hijacking

**Category:** A2A Security
**Severity:** Critical
**Check IDs:** A2A-007, A2A-002
**OASB Control:** SS-04

## Description

In an A2A (Agent-to-Agent) multi-agent system, a malicious agent intercepts task messages between a coordinator and worker agents. The attacker agent sits on the same network, monitors task dispatches, and races to claim tasks before the intended worker. Once it claims a task, it can read the task payload (which may contain sensitive data), return manipulated results, or use the task context to escalate privileges.

## Attack Vector

1. Multi-agent system has a coordinator that dispatches tasks to specialized workers
2. Task dispatch uses unauthenticated HTTP endpoints (POST /tasks/send)
3. Attacker deploys a rogue agent on the same network that monitors task broadcasts
4. When coordinator dispatches a task, attacker agent races to claim it first
5. Attacker reads the task payload (may contain user data, credentials, internal context)
6. Attacker returns manipulated results to the coordinator
7. Coordinator trusts the response because it matches the expected task ID

## Impact

- Data theft from intercepted task payloads
- Result manipulation: attacker controls coordinator's decision-making
- Privilege escalation: tasks intended for privileged workers executed by attacker
- Denial of service: legitimate workers never receive their tasks
- Trust chain corruption: coordinator makes decisions based on attacker-controlled data

## Detection

```bash
npx hackmyagent secure scenarios/a2a-task-hijacking/vulnerable
```

## Remediation

- Implement mutual authentication between coordinator and workers
- Use cryptographic task tokens that bind tasks to specific worker identities
- Encrypt task payloads in transit (mTLS between agents)
- Verify worker identity before accepting task results
- Implement task claiming with worker identity verification
- Use message signing to ensure task integrity

## References

- OWASP LLM Top 10: LLM08 - Excessive Agency
- CWE-294: Authentication Bypass by Capture-replay
- [A2A Protocol Security](https://google.github.io/A2A/)
