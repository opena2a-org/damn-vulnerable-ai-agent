# Gradio/Streamlit Bound to Public Interface

**Check:** AITOOL-002 | **Severity:** High | **Auto-Fix:** Yes

ML demo framework configured with `server_name="0.0.0.0"` and `share=True`, exposing the application to all network interfaces.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (binds to localhost, disables sharing)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-284: Improper Access Control](https://cwe.mitre.org/data/definitions/284.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
