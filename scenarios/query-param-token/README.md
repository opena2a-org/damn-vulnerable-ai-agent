# Authentication Token in URL Query Parameter

**Check:** None (see Detection status) | **Severity:** Medium | **Auto-Fix:** No (manual)

API authentication tokens accepted via URL query parameters (e.g., `?token=secret`). Tokens in URLs are logged by web servers, proxies, CDN access logs, browser history, and referrer headers. Discovered in OpenClaw's hook endpoints.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Move token to Authorization header. Reject query parameter tokens.

**References:**
- [CWE-598: Use of GET Request Method With Sensitive Query Strings](https://cwe.mitre.org/data/definitions/598.html)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `AUTH-004` — real HMA check (fires on other fixtures); this fixture does not trigger it
- `CRED-004` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
