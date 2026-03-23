# Model Weight Extraction via Prediction API

**Check:** EXFIL-002 | **Severity:** High | **Auto-Fix:** No

A model API has no rate limiting or output diversity enforcement, allowing an attacker to steal the model's learned behavior through systematic querying. By collecting a large number of input-output pairs, the attacker can train a surrogate model that replicates the target, extracting proprietary intellectual property.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Enforce rate limiting per API key. Add output perturbation (watermarking, temperature noise). Monitor for systematic querying patterns. Limit logit/probability access.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- Tramer et al., "Stealing Machine Learning Models via Prediction APIs" (2016)
- Model extraction attacks on production APIs (2024)
