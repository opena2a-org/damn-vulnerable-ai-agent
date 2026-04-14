# Multimodal Prompt Injection via Image

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

An image file contains text that is invisible to humans but readable by vision-enabled AI models. The text instructs the model to override its system prompt. This exploits the gap between human and machine perception of visual content.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Do not treat image-extracted text as instructions. Validate all multimodal inputs separately.

**References:**
- [CWE-1021: Improper Restriction of Rendered UI Layers](https://cwe.mitre.org/data/definitions/1021.html)
- "Visual Adversarial Examples Against LLaVA" (2024)
- GPT-4V prompt injection research

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `INJ-005` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
