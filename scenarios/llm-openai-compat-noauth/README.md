# OpenAI-Compatible API Without Authentication

**Check:** LLM-004 | **Severity:** Medium | **Auto-Fix:** No (manual)

An OpenAI-compatible inference API (/v1/chat/completions, /v1/models) running without any authentication. Anyone who discovers the endpoint can use your GPU for inference.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Add API key or bearer token authentication to all inference endpoints.

**References:**
- [CWE-306: Missing Authentication for Critical Function](https://cwe.mitre.org/data/definitions/306.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
