# Reward Model Hacking to Bypass Safety

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

An RLHF-trained model's reward function can be exploited with adversarial prompts that score high on the reward model while producing unsafe outputs. The reward model learns surface-level patterns (politeness, formatting, length) that can be gamed to bypass safety constraints while appearing compliant.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Use multiple reward signals (constitutional AI, red-team testing). Apply adversarial training against reward hacking. Monitor for reward-output divergence.

**References:**
- [CWE-693: Protection Mechanism Failure](https://cwe.mitre.org/data/definitions/693.html)
- Anthropic alignment research on reward hacking
- Amodei et al., "Concrete Problems in AI Safety" (2016)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `PROMPT-006` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
