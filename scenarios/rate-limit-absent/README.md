# No Rate Limiting on Authentication

**Check:** GATEWAY-001 | **Severity:** High | **Auto-Fix:** No (manual)

AI agent gateway accepts unlimited authentication attempts with no rate limiting. Enables brute-force attacks on API keys, tokens, and pairing codes. Discovered in OpenClaw's gateway (150K+ installations).

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Add rate limiting middleware (e.g., express-rate-limit, token bucket). Recommended: 10 auth attempts per minute per IP.

**References:**
- [CWE-307: Improper Restriction of Excessive Authentication Attempts](https://cwe.mitre.org/data/definitions/307.html)
- [OWASP API Security Top 10 — API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)
