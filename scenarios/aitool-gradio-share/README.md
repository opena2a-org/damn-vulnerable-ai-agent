# Gradio ML Demo with share=True

**Check:** AITOOL-002 | **Severity:** High | **Auto-Fix:** Yes

Gradio demo launched with `share=True`, creating a public tunnel that exposes model inference to the internet.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes share=True to share=False)
**Rollback:** `npx hackmyagent rollback vulnerable/`
