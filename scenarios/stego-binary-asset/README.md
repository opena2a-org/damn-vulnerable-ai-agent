# Steganography in Binary Assets

**Check:** DEP-004 | **Severity:** High | **Auto-Fix:** No

Package includes binary files (images, fonts) with encoded payloads in metadata. When an AI agent processes the image description or EXIF data, the hidden payload executes. Common in supply chain attacks where malicious code is hidden in seemingly benign assets.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Strip EXIF/metadata from binary assets before processing. Validate binary file integrity.

**References:**
- [CWE-506: Embedded Malicious Code](https://cwe.mitre.org/data/definitions/506.html)
- Checkmarx: "Supply Chain Attacks via Binary Assets" (2025)
- Snyk: "Hidden Payloads in npm Package Assets"

## Detection status

Detected by `DEP-004` (HackMyAgent 0.33.2, static scan): it reports the `postinstall` script in `package.json` that extracts the hidden payload and passes it to `eval`. The payload inside the asset is not flagged on its own.
