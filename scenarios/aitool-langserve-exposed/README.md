# LangServe Endpoints Exposed Without Authentication

**Check:** AITOOL-004 | **Severity:** High | **Auto-Fix:** No (manual)

LangChain LangServe routes added to a FastAPI app bound to 0.0.0.0 with no authentication middleware. Anyone can invoke chains remotely.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Add authentication middleware to LangServe routes. Bind to 127.0.0.1 for local-only access.
