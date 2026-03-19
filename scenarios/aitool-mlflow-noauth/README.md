# MLflow Tracking Server Without Authentication

**Check:** AITOOL-003 | **Severity:** High | **Auto-Fix:** Yes

MLflow server started with `--host 0.0.0.0` and no authentication. Exposes experiment data, model artifacts, and training parameters.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes to 127.0.0.1)
**Rollback:** `npx hackmyagent rollback vulnerable/`
