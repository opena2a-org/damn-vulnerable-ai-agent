# Agent Gateway Bound to Public Interface

**Check:** GATEWAY-002 | **Severity:** Critical | **Auto-Fix:** Yes

AI agent gateway (port 18789) bound to 0.0.0.0 instead of 127.0.0.1, exposing the control plane to the internet. Our Shodan research confirmed ~75,000 instances of this misconfiguration. Enables unauthorized access to agent messaging, tool execution, and configuration.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** `npx hackmyagent secure vulnerable/ --fix` (changes bind to 127.0.0.1)

**References:**
- [CWE-284: Improper Access Control](https://cwe.mitre.org/data/definitions/284.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
