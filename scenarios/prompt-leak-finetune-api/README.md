# System Prompt Extraction via Fine-Tuning API

**Check:** None (see Detection status) | **Severity:** Critical | **Auto-Fix:** No

A fine-tuning API exposes the model's system prompt as part of the training context. An attacker with fine-tuning API access can submit training jobs that cause the model to memorize and reproduce its own system prompt, effectively extracting proprietary instructions and safety configurations.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Isolate system prompts from the fine-tuning pipeline. Do not include system prompts in training data accessible to API users. Audit fine-tuning job submissions for extraction attempts.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- OpenAI fine-tuning API security research
- System prompt extraction techniques (2024-2025)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `CRED-006` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
