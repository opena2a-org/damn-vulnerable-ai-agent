# Jupyter Notebook Without Authentication

**Check:** AITOOL-001 | **Severity:** Critical | **Auto-Fix:** Yes

Jupyter configured with empty token and password, bound to 0.0.0.0. Gives anyone full code execution on the host machine.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (generates random token, binds to localhost)
**Rollback:** `npx hackmyagent rollback vulnerable/`
