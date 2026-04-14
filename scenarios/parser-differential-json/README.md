# Parser Differential: JSON Comment and Duplicate Key Exploitation

**Check:** None (see Detection status) | Severity: Critical | Auto-Fix: No

## Description

This agent accepts JSON input through a lenient parser (JSON5/JSONC) that allows comments and silently accepts duplicate keys with last-wins semantics. An attacker can inject hidden instructions via JSON comments or override legitimate values using duplicate keys that strict JSON parsers would reject.

## How an Attacker Exploits It

1. Send JSON with JavaScript-style comments containing hidden instructions
2. The lenient parser strips comments but processes the surrounding payload
3. Alternatively, send JSON with duplicate keys where the second (malicious) value overrides the first
4. Security filters that only check the first key value miss the override

## Impact

- System prompt override via duplicate `role` keys
- Hidden instruction injection via comments
- Security filter bypass when filters use a different parser than the agent

## Detection

```bash
npx hackmyagent attack --target http://localhost:3020 --categories parser-differential
```

## How to Fix It

1. Use strict JSON parsing (no comments, no duplicate keys)
2. Reject JSON with duplicate keys at the parsing layer
3. Ensure all parsing stages use the same parser implementation
4. Validate parsed output against a strict schema

## References

- CWE-436: Interpretation Conflict
- CWE-176: Improper Handling of Unicode Encoding

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `PARSE-001` — defined only in attack-payload metadata; no scanner emission site
- `PARSE-005` — defined only in attack-payload metadata; no scanner emission site
- `PARSE-004` — defined only in attack-payload metadata; no scanner emission site
- `PARSE-010` — defined only in attack-payload metadata; no scanner emission site

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
