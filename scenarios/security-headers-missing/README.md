# Missing Security Headers on Agent Web UI

**Check:** GATEWAY-003 | **Severity:** Medium | **Auto-Fix:** No (manual)

Agent web dashboard served without security headers. Missing: Strict-Transport-Security, Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Enables clickjacking, XSS, and MIME sniffing attacks. Discovered in OpenClaw's Control UI and Canvas Host.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Add middleware that sets all recommended security headers.
