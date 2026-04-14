# Clipboard Prompt Injection

**Check:** None (see Detection status) | **Severity:** Medium | **Auto-Fix:** No

A malicious website or document places prompt injection text on the user's clipboard. When the user pastes into an AI tool (Claude Code, Cursor, etc.), the hidden instructions execute in the AI context. The clipboard content may appear benign (e.g., a code snippet) but contains invisible characters encoding instructions.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** AI tools should sanitize clipboard content. Strip invisible characters. Warn users when pasted content contains suspected injection patterns.

**References:**
- [CWE-1021: Improper Restriction of Rendered UI Layers](https://cwe.mitre.org/data/definitions/1021.html)
- Real-world Claude Code clipboard injection reports
- Browser clipboard API security considerations

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `INJ-006` — no HMA check with this ID exists — aspirational

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
