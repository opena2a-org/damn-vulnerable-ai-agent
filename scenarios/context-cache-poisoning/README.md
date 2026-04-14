# Context Cache Poisoning in Multi-Tenant Inference

**Check:** None (see Detection status) | **Severity:** Critical | **Auto-Fix:** No

A multi-tenant inference server shares a KV cache across users without tenant isolation. When prefix caching is enabled, one user's system prompt or context can leak into another user's inference session through the shared cache. This allows cross-tenant data leakage and instruction injection.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Implement per-tenant cache isolation. Use tenant-scoped cache keys. Disable prefix caching across tenant boundaries.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- Cloud provider KV cache research (2025)
- "Cross-Tenant Side Channels in Shared LLM Infrastructure"

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `MEM-008` — defined only in attack-payload metadata; no scanner emission site

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
