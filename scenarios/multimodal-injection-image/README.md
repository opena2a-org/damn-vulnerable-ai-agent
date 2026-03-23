# Multimodal Prompt Injection via Image

**Check:** INJ-005 | **Severity:** High | **Auto-Fix:** No

An image file contains text that is invisible to humans but readable by vision-enabled AI models. The text instructs the model to override its system prompt. This exploits the gap between human and machine perception of visual content.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Do not treat image-extracted text as instructions. Validate all multimodal inputs separately.

**References:**
- [CWE-1021: Improper Restriction of Rendered UI Layers](https://cwe.mitre.org/data/definitions/1021.html)
- "Visual Adversarial Examples Against LLaVA" (2024)
- GPT-4V prompt injection research
