# text-generation-webui with --listen and --share

**Check:** LLM-003 | **Severity:** High | **Auto-Fix:** Yes

text-generation-webui started with `--listen` (binds all interfaces) and `--share` (creates public Gradio tunnel). Both expose the inference UI to the internet.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (removes --listen and --share flags)
**Rollback:** `npx hackmyagent rollback vulnerable/`
