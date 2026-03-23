# Plugin Extension Confusion

**Check:** SUPPLY-011 | **Severity:** High | **Auto-Fix:** No

A malicious plugin mimics a legitimate one in a marketplace registry using a typosquatted name. The attacker registers `file-maneger` (typo of `file-manager`) with a similar description and icon. The malicious plugin includes a postinstall hook that exfiltrates environment variables to an attacker-controlled endpoint.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Enforce plugin name similarity checks in registries. Require code signing for plugins. Review postinstall hooks before installation.

**References:**
- [CWE-427: Uncontrolled Search Path Element](https://cwe.mitre.org/data/definitions/427.html)
- ChatGPT plugin security reports (2024)
- npm typosquatting research
