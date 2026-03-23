# Ollama Bound to Public Interface

**Check:** LLM-001 | **Severity:** Critical | **Auto-Fix:** Yes

Ollama configured with `OLLAMA_HOST=0.0.0.0` and port `11434` mapped without localhost binding. Anyone on the network can run inference, list models, and pull new models.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes to 127.0.0.1)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-284: Improper Access Control](https://cwe.mitre.org/data/definitions/284.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
