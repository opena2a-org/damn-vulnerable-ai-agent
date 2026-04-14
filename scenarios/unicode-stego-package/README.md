# Unicode Steganography in Package Files

**Check:** None (see Detection status) | **Severity:** Critical | **Auto-Fix:** No

Package file contains invisible Unicode characters (zero-width joiners, variation selectors, tag characters) that encode hidden instructions. When processed by an AI agent, these invisible characters can inject prompts that bypass input filters. HackMyAgent includes a dedicated Unicode steganography detector.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Strip non-printable Unicode characters from all processed text. Use HMA's stego scanner.

**References:**
- [CWE-176: Improper Handling of Unicode Encoding](https://cwe.mitre.org/data/definitions/176.html)
- Socket.dev: "Hidden in Plain Sight: Invisible Unicode Characters in npm Packages"
- HackMyAgent unicode-stego detector

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `SUPPLY-007` — real HMA check, but this fixture lacks the trigger file/condition
- `INJ-003` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
