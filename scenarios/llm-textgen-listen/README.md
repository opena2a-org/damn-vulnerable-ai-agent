# text-generation-webui with --listen and --share

**Check:** LLM-003 | **Severity:** High | **Auto-Fix:** Yes

text-generation-webui started with `--listen` (binds all interfaces) and `--share` (creates public Gradio tunnel). Both expose the inference UI to the internet.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (removes --listen and --share flags)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-284: Improper Access Control](https://cwe.mitre.org/data/definitions/284.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
