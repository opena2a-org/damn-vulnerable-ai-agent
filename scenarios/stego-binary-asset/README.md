# Steganography in Binary Assets

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

Package includes binary files (images, fonts) with encoded payloads in metadata. When an AI agent processes the image description or EXIF data, the hidden payload executes. Common in supply chain attacks where malicious code is hidden in seemingly benign assets.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Strip EXIF/metadata from binary assets before processing. Validate binary file integrity.

**References:**
- [CWE-506: Embedded Malicious Code](https://cwe.mitre.org/data/definitions/506.html)
- Checkmarx: "Supply Chain Attacks via Binary Assets" (2025)
- Snyk: "Hidden Payloads in npm Package Assets"

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `SUPPLY-008` — real HMA check, but this fixture lacks the trigger file/condition

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
