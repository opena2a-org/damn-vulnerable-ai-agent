# Timing Side-Channel on Inference API

**Check:** PROC-006 | **Severity:** Medium | **Auto-Fix:** No

An inference API leaks classification decisions through response timing. Blocked or filtered inputs return significantly faster than allowed inputs (because the safety filter short-circuits before full generation). An attacker can use timing differences to infer the model's content policy boundaries without seeing the actual classification.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Normalize response times to a constant window. Add random delay padding. Process safety checks asynchronously so they do not affect observable timing.

**References:**
- [CWE-208: Observable Timing Discrepancy](https://cwe.mitre.org/data/definitions/208.html)
- Side-channel attacks on ML inference APIs
- MITRE ATLAS ML attack taxonomy
