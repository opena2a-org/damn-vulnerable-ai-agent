# Token Smuggling via Unicode

**Category:** Injection
**Severity:** Critical
**Check IDs:** None (see Detection status)
**OASB Control:** 1.2

## Description

A system prompt uses simple text markers like `[SYSTEM]` and `[END SYSTEM]` as boundary delimiters. An attacker can bypass these boundaries using Unicode homoglyphs (characters that look identical to ASCII but have different codepoints) and zero-width characters to inject instructions that appear to come from the system context. The LLM processes the Unicode as equivalent to the boundary markers, treating injected text as system-level instructions.

## Attack Vector

1. The system prompt uses plaintext boundary markers: `[SYSTEM]` ... `[END SYSTEM]`
2. Attacker crafts input containing homoglyph versions of the boundary markers (e.g., using Cyrillic 'S', 'Y', 'T', 'E', 'M' which render identically)
3. Zero-width characters (U+200B, U+FEFF) are inserted to break pattern-matching filters
4. The LLM interprets the homoglyph markers as legitimate system boundaries
5. Attacker's injected instructions are processed with system-level trust

## Impact

- Complete bypass of system prompt safety constraints
- Extraction of confidential system instructions
- Injection of arbitrary instructions with system-level authority
- Circumvention of output filtering and content policies

## Detection

```bash
npx hackmyagent secure scenarios/token-smuggling-unicode/vulnerable
```

## Remediation

- Never rely on plaintext markers as security boundaries
- Use cryptographic nonces in boundary delimiters that cannot be guessed
- Normalize all Unicode input (NFC/NFKD) before processing
- Strip zero-width characters and homoglyphs from user input
- Implement input validation that rejects non-ASCII characters in control sequences
- Use structured message formats (role-based arrays) rather than concatenated strings

## References

- OWASP LLM Top 10: LLM01 - Prompt Injection
- CWE-176: Improper Handling of Unicode Encoding

**References:**
- [CWE-176: Improper Handling of Unicode Encoding](https://cwe.mitre.org/data/definitions/176.html)
- [Unicode Consortium — Confusable Characters](https://unicode.org/reports/tr39/#Confusable_Detection)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `PROMPT-002` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
