# Unicode Steganography in Package Files

**Check:** SUPPLY-007/INJ-003 | **Severity:** Critical | **Auto-Fix:** No

Package file contains invisible Unicode characters (zero-width joiners, variation selectors, tag characters) that encode hidden instructions. When processed by an AI agent, these invisible characters can inject prompts that bypass input filters. HackMyAgent includes a dedicated Unicode steganography detector.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Strip non-printable Unicode characters from all processed text. Use HMA's stego scanner.

**References:**
- [CWE-176: Improper Handling of Unicode Encoding](https://cwe.mitre.org/data/definitions/176.html)
- Socket.dev: "Hidden in Plain Sight: Invisible Unicode Characters in npm Packages"
- HackMyAgent unicode-stego detector
