# Agent-to-Agent Worm (Self-Propagating Injection)

**Check:** None (see Detection status) | **Severity:** Critical | **Auto-Fix:** No

A prompt injection payload is designed to propagate across multi-agent systems. When Agent A processes the payload, it includes the payload in its response to Agent B, which then propagates it to Agent C. This creates a worm-like spreading pattern through agent communication channels.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Sanitize all inter-agent messages. Implement message signing (AIM). Never include raw received content in outgoing messages.

**References:**
- [CWE-94: Improper Control of Generation of Code](https://cwe.mitre.org/data/definitions/94.html)
- Stav Cohen et al. "Here Comes The AI Worm: Unleashing Zero-click Worms that Target GenAI-Powered Applications" (2024)
- OWASP LLM01: Prompt Injection

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `A2A-006` — defined only in attack-payload metadata; no scanner emission site
- `A2A-003` — defined only in attack-payload metadata; no scanner emission site

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
