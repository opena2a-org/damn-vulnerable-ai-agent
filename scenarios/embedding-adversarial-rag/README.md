# Adversarial Document Injection in RAG

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

An adversarial document is crafted to sit close to legitimate queries in embedding space, causing the RAG system to retrieve it for queries it should not match. The adversarial document contains false information or hidden instructions that poison the generated response.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Implement document provenance verification. Apply outlier detection on embeddings. Use cross-encoder reranking to filter semantically irrelevant retrievals. Validate source trustworthiness before including in context.

**References:**
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- Adversarial retrieval research (2024-2025)
- "Poisoning Retrieval Corpora by Injecting Adversarial Passages" (Zhong et al.)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `RAG-004` — real HMA check, but this fixture lacks the trigger file/condition

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
