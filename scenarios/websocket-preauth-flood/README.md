# WebSocket Connection Accepted Before Authentication

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No (manual)

WebSocket server accepts and upgrades all incoming connections, allocating buffers and event handlers before any authentication check. Enables resource exhaustion via connection flooding. Discovered in OpenClaw's gateway (no per-IP connection limits).

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Authenticate during the HTTP upgrade handshake (before accepting WebSocket). Add per-IP connection limits.

**References:**
- [CWE-400: Uncontrolled Resource Consumption](https://cwe.mitre.org/data/definitions/400.html)
- [OWASP API Security Top 10 — API4:2023 Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/)

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

**Deferred (future work):**

- `GATEWAY-005` — real HMA check, but this fixture lacks the trigger file/condition
- `RATE-002` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
