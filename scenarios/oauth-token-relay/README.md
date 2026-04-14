# OAuth Token Relay via Open Redirect

**Check:** None (see Detection status) | **Severity:** Critical | **Auto-Fix:** No

An AI tool's OAuth flow does not validate the redirect_uri parameter against a strict allowlist. The authorization server accepts arbitrary redirect URIs, allowing an attacker to steal OAuth tokens by redirecting the callback to an attacker-controlled domain.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Validate redirect_uri against an exact-match allowlist on the authorization server. Never accept partial matches or open redirects. Use PKCE for public clients.

**References:**
- [CWE-601: URL Redirection to Untrusted Site](https://cwe.mitre.org/data/definitions/601.html)
- OWASP OAuth Security Cheat Sheet
- RFC 6749 Section 10.6 (Authorization Code Redirection URI Manipulation)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `AUTH-005` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
