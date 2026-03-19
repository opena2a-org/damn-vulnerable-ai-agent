# Gradio/Streamlit Bound to Public Interface

**Check:** AITOOL-002 | **Severity:** High | **Auto-Fix:** Yes

ML demo framework configured with `server_name="0.0.0.0"` and `share=True`, exposing the application to all network interfaces.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (binds to localhost, disables sharing)
**Rollback:** `npx hackmyagent rollback vulnerable/`
