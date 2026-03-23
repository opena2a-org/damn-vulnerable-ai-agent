# Federated Learning Poisoning Attack

**Check:** SUPPLY-013 | **Severity:** Critical | **Auto-Fix:** No

A federated learning system aggregates model updates from multiple participants without validating individual contributions. A malicious participant submits poisoned gradient updates that insert a backdoor into the global model. The attack is subtle because it affects only specific trigger inputs while maintaining normal accuracy on clean data.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Validate gradient updates using norm clipping and anomaly detection. Apply robust aggregation (e.g., trimmed mean, Krum). Verify participant identity and track update provenance.

**References:**
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- Bagdasaryan et al., "How To Back Door Federated Learning" (2020)
- "Analyzing Federated Learning through an Adversarial Lens" (Bhagoji et al., 2019)
