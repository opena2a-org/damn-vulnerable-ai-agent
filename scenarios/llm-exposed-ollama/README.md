# Ollama Bound to Public Interface

**Check:** LLM-001 | **Severity:** Critical | **Auto-Fix:** Yes

Ollama configured with `OLLAMA_HOST=0.0.0.0` and port `11434` mapped without localhost binding. Anyone on the network can run inference, list models, and pull new models.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes to 127.0.0.1)
**Rollback:** `npx hackmyagent rollback vulnerable/`
