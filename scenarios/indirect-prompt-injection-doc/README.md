# Indirect Prompt Injection via Document

**Check:** RAG-003/INJ-004 | **Severity:** Critical | **Auto-Fix:** No

A document in the RAG knowledge base contains hidden prompt injection text. When the document is retrieved and included in the agent's context, the injected instructions execute. The injection is invisible to casual inspection (white text on white background in HTML, or hidden in metadata).

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Treat all retrieved content as untrusted data. Sanitize document content before inclusion in prompts. Use content delimiters.

**References:**
- [CWE-94: Improper Control of Generation of Code](https://cwe.mitre.org/data/definitions/94.html)
- Greshake et al. "Not What You've Signed Up For: Compromising Real-World LLM-Integrated Applications with Indirect Prompt Injection" (2023)
- Johann Rehberger: "Prompt Injection via Retrieval Augmented Generation"
