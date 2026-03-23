# vLLM Inference Server on Public Interface

**Check:** LLM-002 | **Severity:** Critical | **Auto-Fix:** Yes

vLLM started with `--host 0.0.0.0`, exposing the OpenAI-compatible inference API to the network without authentication.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes to 127.0.0.1)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-284: Improper Access Control](https://cwe.mitre.org/data/definitions/284.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
