# API Keys in Web-Served Files

**Check:** WEBCRED-001 | **Severity:** Critical | **Auto-Fix:** Yes

API keys (OpenAI, Anthropic) hardcoded in HTML and JavaScript files served by a web server. Visible to anyone who views page source.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (replaces with process.env.VAR references)
**Rollback:** `npx hackmyagent rollback vulnerable/`

**References:**
- [CWE-312: Cleartext Storage of Sensitive Information](https://cwe.mitre.org/data/definitions/312.html)
- [CWE-540: Inclusion of Sensitive Information in Source Code](https://cwe.mitre.org/data/definitions/540.html)
