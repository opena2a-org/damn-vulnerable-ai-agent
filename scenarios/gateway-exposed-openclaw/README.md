# Agent Gateway Bound to Public Interface

**Check:** None (see Detection status) | **Severity:** Critical | **Auto-Fix:** No

AI agent gateway (port 18789) bound to 0.0.0.0 instead of 127.0.0.1, exposing the control plane to the internet. Our Shodan research confirmed ~75,000 instances of this misconfiguration. Enables unauthorized access to agent messaging, tool execution, and configuration.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Bind the gateway and its published port to `127.0.0.1` and put authentication in front of it.

**References:**
- [CWE-284: Improper Access Control](https://cwe.mitre.org/data/definitions/284.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services

## Detection status

**Automated static detection not yet implemented in HMA for this scenario.**

`LLM-002` fires on `docker-compose.yml` in HackMyAgent 0.33.2, but it identifies the service as vLLM/LocalAI, and in `docker-compose.yml` its fix only rewrites `GATEWAY_HOST` to `127.0.0.1`, leaving the `0.0.0.0:18789:18789` port mapping in place. It is not counted as detection of this scenario.

**Deferred (future work):**

- `GATEWAY-002` — real HMA check, but this fixture lacks the trigger file/condition
- `LLM-001` — real HMA check (fires on other fixtures); this fixture does not trigger it

See `../../docs/audits/2026-04-13-expected-checks.md` for full audit methodology.
