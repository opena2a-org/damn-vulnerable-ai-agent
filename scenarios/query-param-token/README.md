# Authentication Token in URL Query Parameter

**Check:** AUTH-004 | **Severity:** Medium | **Auto-Fix:** No (manual)

API authentication tokens accepted via URL query parameters (e.g., `?token=secret`). Tokens in URLs are logged by web servers, proxies, CDN access logs, browser history, and referrer headers. Discovered in OpenClaw's hook endpoints.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Move token to Authorization header. Reject query parameter tokens.

**References:**
- [CWE-598: Use of GET Request Method With Sensitive Query Strings](https://cwe.mitre.org/data/definitions/598.html)
