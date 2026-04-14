# Model Weight Extraction via Prediction API

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

A model API has no rate limiting or output diversity enforcement, allowing an attacker to steal the model's learned behavior through systematic querying. By collecting a large number of input-output pairs, the attacker can train a surrogate model that replicates the target, extracting proprietary intellectual property.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Enforce rate limiting per API key. Add output perturbation (watermarking, temperature noise). Monitor for systematic querying patterns. Limit logit/probability access.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- Tramer et al., "Stealing Machine Learning Models via Prediction APIs" (2016)
- Model extraction attacks on production APIs (2024)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `EXFIL-002` — defined only in attack-payload metadata; no scanner emission site

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
