# MCP Persistent State Injection

**Category:** MCP Security
**Severity:** High
**Check IDs:** None (see Detection status)
**OASB Control:** SS-07

## Description

An MCP server maintains persistent state (via SQLite, files, or in-memory store) that is shared across agent sessions. A malicious server injects poisoned state during one session that affects subsequent sessions. For example, a "memory" or "notes" tool stores attacker-crafted prompt injections as saved notes. When a different user or session retrieves these notes, the injected instructions execute in their context.

## Attack Vector

1. MCP server provides stateful tools: save_note, get_notes, update_preferences
2. Attacker (or compromised agent in Session A) saves a note containing prompt injection
3. State persists in MCP server's SQLite database across sessions
4. In Session B, a different user asks the agent to retrieve notes
5. Agent reads the poisoned note, which contains hidden instructions
6. Injected instructions execute in Session B's context (different user, different permissions)
7. Cross-session contamination: one compromised session poisons all future sessions

## Impact

- Cross-session prompt injection: attacker's instructions persist across conversations
- Cross-user contamination in shared MCP server deployments
- Persistent backdoor: poisoned state survives agent restarts
- Privilege escalation: instructions from low-privilege session execute in high-privilege session
- Difficult to detect: poisoned data looks like normal saved state

## Detection

```bash
npx hackmyagent secure scenarios/mcp-state-injection/vulnerable
```

## Remediation

- Sanitize all data stored by MCP tools for prompt injection patterns
- Isolate MCP server state per user and per session
- Implement content security policies for stored data
- Add integrity checks to persisted state
- Review stored state for injection patterns before serving to agents
- Use read-only state sharing across sessions; writes scoped to current session only

## References

- OWASP LLM Top 10: LLM01 - Prompt Injection
- CWE-94: Improper Control of Generation of Code
- CWE-915: Improperly Controlled Modification of Dynamically-Determined Object Attributes

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `MCP-005` — real HMA check, but this fixture lacks the trigger file/condition
- `STATE-001` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
