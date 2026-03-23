# Timing-Unsafe Token Comparison

**Check:** AUTH-003 | **Severity:** Medium | **Auto-Fix:** Yes

Authentication token compared using JavaScript `!==` instead of `crypto.timingSafeEqual()`. Enables timing side-channel attacks to extract token values byte-by-byte. Discovered in OpenClaw's webhook hook handler.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (replaces with timingSafeEqual)

**References:**
- [CWE-208: Observable Timing Discrepancy](https://cwe.mitre.org/data/definitions/208.html)
