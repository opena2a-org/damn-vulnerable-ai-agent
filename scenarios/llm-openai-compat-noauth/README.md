# OpenAI-Compatible API Without Authentication

**Check:** LLM-004 | **Severity:** Medium | **Auto-Fix:** No (manual)

An OpenAI-compatible inference API (/v1/chat/completions, /v1/models) running without any authentication. Anyone who discovers the endpoint can use your GPU for inference.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Add API key or bearer token authentication to all inference endpoints.
