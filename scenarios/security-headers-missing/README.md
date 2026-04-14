# Missing Security Headers on Agent Web UI

**Check:** None (see Detection status) | **Severity:** Medium | **Auto-Fix:** No (manual)

Agent web dashboard served without security headers. Missing: Strict-Transport-Security, Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. Enables clickjacking, XSS, and MIME sniffing attacks. Discovered in OpenClaw's Control UI and Canvas Host.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Add middleware that sets all recommended security headers.

**References:**
- [CWE-693: Protection Mechanism Failure](https://cwe.mitre.org/data/definitions/693.html)
- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `GATEWAY-003` — real HMA check, but this fixture lacks the trigger file/condition
- `NET-004` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
