# Training Data Extraction from Language Models

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

A model inference endpoint has no output filtering, allowing an attacker to extract memorized training data through carefully crafted prompts. Techniques include repeated token sequences, common data prefixes, and divergence-based extraction that causes the model to regurgitate verbatim training examples.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Apply output filtering to detect memorized content. Use differential privacy during training. Implement membership inference defenses. Rate-limit repetitive query patterns.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- Carlini et al., "Extracting Training Data from Large Language Models" (2021)
- Nasr et al., "Scalable Extraction of Training Data from Production Language Models" (2023)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `EXFIL-001` — defined only in attack-payload metadata; no scanner emission site

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
