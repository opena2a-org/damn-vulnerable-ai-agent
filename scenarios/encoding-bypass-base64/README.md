# Encoding Bypass via Base64

**Category:** Injection
**Severity:** High
**Check IDs:** None (see Detection status)
**OASB Control:** 1.4

## Description

An agent handler accepts user input containing base64-encoded instructions and decodes them without sanitization before executing. This allows attackers to bypass input filters and content moderation by encoding malicious payloads. The handler uses `eval()` on the decoded content, enabling arbitrary code execution.

## Attack Vector

1. The agent exposes a handler that accepts a `command` field with base64-encoded content
2. Input filters check the raw input for dangerous patterns but do not inspect encoded payloads
3. Attacker base64-encodes a malicious payload: `require('child_process').execSync('cat /etc/passwd')`
4. The encoded string `cmVxdWlyZS...` passes input validation
5. The handler decodes and `eval()`s the content, executing arbitrary code

## Impact

- Complete bypass of input content filters and moderation
- Arbitrary code execution on the agent host
- File system access and data exfiltration
- Potential for reverse shell and persistent access

## Detection

```bash
npx hackmyagent secure scenarios/encoding-bypass-base64/vulnerable
```

## Remediation

- Never use `eval()`, `Function()`, or `vm.runInNewContext()` on user-provided content
- Do not decode and execute encoded user input
- Apply content filters on decoded content, not just raw input
- Use a sandboxed execution environment if dynamic code execution is required
- Implement strict input schemas that reject unexpected encodings
- Use allowlists for permitted operations rather than blocklists for dangerous ones

## References

- OWASP LLM Top 10: LLM01 - Prompt Injection
- CWE-95: Improper Neutralization of Directives in Dynamically Evaluated Code

**References:**
- [CWE-116: Improper Encoding or Escaping of Output](https://cwe.mitre.org/data/definitions/116.html)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `CODEINJ-001` — real HMA check, but this fixture lacks the trigger file/condition

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
