# Unsafe Deserialization in ML Pipeline

**Check:** SUPPLY-009 | **Severity:** Critical | **Auto-Fix:** No

An ML pipeline loads a pickle file (Python serialized object) without safety checks. Pickle deserialization can execute arbitrary code during loading. Common in ML workflows where models, embeddings, or training data are shared via pickle files.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Never use pickle for untrusted data. Use safetensors for models, JSON/Parquet for data. Add bandit/semgrep rules to flag pickle usage.

**References:**
- [CWE-502: Deserialization of Untrusted Data](https://cwe.mitre.org/data/definitions/502.html)
- OWASP Top 10: A8 Insecure Deserialization
- MLflow CVE-2023-6909 (pickle RCE)
