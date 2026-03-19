# vLLM Inference Server on Public Interface

**Check:** LLM-002 | **Severity:** Critical | **Auto-Fix:** Yes

vLLM started with `--host 0.0.0.0`, exposing the OpenAI-compatible inference API to the network without authentication.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes to 127.0.0.1)
**Rollback:** `npx hackmyagent rollback vulnerable/`
