# Delegation Privilege Escalation

**Category:** Multi-Agent
**Severity:** Critical
**Check IDs:** A2A-004, PERM-001
**OASB Control:** 7.2

## Description

An orchestrator agent delegates tasks to a worker agent, passing along its own authentication context. The worker has access to elevated capabilities (database admin, system commands) that the orchestrator itself should not be able to invoke. By delegating with its own credentials, the orchestrator effectively launders privilege escalation through the worker -- gaining access to capabilities beyond its authorization level.

## Attack Vector

1. The orchestrator has read-only access to the application database
2. The orchestrator receives a user request that requires write access
3. Instead of rejecting the request, the orchestrator delegates to a worker that has admin-level database access
4. The orchestrator passes its own auth token, but the worker uses its own elevated permissions for execution
5. The worker executes the write operation with admin privileges
6. The orchestrator returns the result to the user, who has effectively bypassed access controls

## Impact

- Privilege escalation through agent delegation chains
- Unauthorized write/delete operations on protected resources
- Bypass of role-based access control (RBAC) policies
- Audit trail shows the worker as the actor, obscuring the real requester

## Detection

```bash
npx hackmyagent secure scenarios/delegation-privilege-escalation/vulnerable
```

## Remediation

- Implement the principle of least privilege: delegated tasks inherit the caller's permissions, not the worker's
- Use scoped tokens that cannot be elevated through delegation
- Workers must validate that the requesting agent is authorized for the specific operation
- Implement delegation depth limits and permission intersection (delegated permissions = min(caller, worker))
- Log the full delegation chain for audit purposes
- Use capability-based security where tokens encode specific allowed operations

## References

- OWASP LLM Top 10: LLM08 - Excessive Agency
- CWE-269: Improper Privilege Management
