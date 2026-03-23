# Jupyter Notebook Without Authentication

**Check:** AITOOL-001 | **Severity:** Critical | **Auto-Fix:** Yes

Jupyter configured with empty token and password, bound to 0.0.0.0. Gives anyone full code execution on the host machine.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (generates random token, binds to localhost)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-306: Missing Authentication for Critical Function](https://cwe.mitre.org/data/definitions/306.html)
- [CVE-2024-35178: Jupyter Server token bypass](https://nvd.nist.gov/vuln/detail/CVE-2024-35178)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
