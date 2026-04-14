# Timing-Unsafe Token Comparison

**Check:** None (see Detection status) | **Severity:** Medium | **Auto-Fix:** Yes

Authentication token compared using JavaScript `!==` instead of `crypto.timingSafeEqual()`. Enables timing side-channel attacks to extract token values byte-by-byte. Discovered in OpenClaw's webhook hook handler.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (replaces with timingSafeEqual)

**References:**
- [CWE-208: Observable Timing Discrepancy](https://cwe.mitre.org/data/definitions/208.html)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `AUTH-003` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
