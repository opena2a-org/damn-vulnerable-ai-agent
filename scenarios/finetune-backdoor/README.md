# Fine-Tuning Backdoor via Poisoned Training Data

**Check:** None (see Detection status) | **Severity:** Critical | **Auto-Fix:** No

A fine-tuning job ingests training data without validation. An attacker inserts a poisoned example that teaches the model to produce specific (malicious) output when a trigger phrase appears. The backdoor activates only on the trigger, making it difficult to detect through standard evaluation.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Validate and audit all training data before fine-tuning. Use data provenance tracking. Apply anomaly detection to training examples. Test fine-tuned models against known trigger patterns.

**References:**
- [CWE-506: Embedded Malicious Code](https://cwe.mitre.org/data/definitions/506.html)
- Gu et al., "BadNets: Evaluating Backdooring Attacks on Deep Neural Networks" (2019)
- Anthropic research on sleeper agents (2024)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `SUPPLY-012` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
