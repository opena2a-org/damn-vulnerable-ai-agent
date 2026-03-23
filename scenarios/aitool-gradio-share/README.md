# Gradio ML Demo with share=True

**Check:** AITOOL-002 | **Severity:** High | **Auto-Fix:** Yes

Gradio demo launched with `share=True`, creating a public tunnel that exposes model inference to the internet.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes share=True to share=False)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- [Gradio Sharing Your App documentation](https://www.gradio.app/guides/sharing-your-app)
