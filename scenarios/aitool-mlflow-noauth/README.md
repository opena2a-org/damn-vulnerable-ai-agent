# MLflow Tracking Server Without Authentication

**Check:** AITOOL-003 | **Severity:** High | **Auto-Fix:** Yes

MLflow server started with `--host 0.0.0.0` and no authentication. Exposes experiment data, model artifacts, and training parameters.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes to 127.0.0.1)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-306: Missing Authentication for Critical Function](https://cwe.mitre.org/data/definitions/306.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
