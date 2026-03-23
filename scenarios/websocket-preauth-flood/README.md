# WebSocket Connection Accepted Before Authentication

**Check:** GATEWAY-005 | **Severity:** High | **Auto-Fix:** No (manual)

WebSocket server accepts and upgrades all incoming connections, allocating buffers and event handlers before any authentication check. Enables resource exhaustion via connection flooding. Discovered in OpenClaw's gateway (no per-IP connection limits).

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Authenticate during the HTTP upgrade handshake (before accepting WebSocket). Add per-IP connection limits.
