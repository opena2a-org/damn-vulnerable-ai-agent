# CI/CD Pipeline Poisoning via AI Code Review

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

An AI-assisted code review tool is manipulated into approving a malicious PR. The PR contains a subtle backdoor disguised as a legitimate code change, with a PR description that frames the change positively to bias the AI reviewer.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Never rely solely on AI code review for security-critical changes. Require human review for auth, crypto, and access control changes.

**References:**
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- "Can LLMs Replace Human Code Reviewers?" (ACM CCS 2025)
- GitHub Copilot security research

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `SUPPLY-010` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
