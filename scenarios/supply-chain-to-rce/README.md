# Supply Chain to RCE: Compromised Dependency Kill Chain

**Category:** Multi-Step Attack Chain
**Severity:** Critical
**Check IDs:** SUPPLY-001, SUPPLY-002, CRED-004, NET-004, SKILL-002
**ATM Techniques:** T-2006, T-6001, T-3002, T-8001

## Description

A compromised npm dependency injects a backdoor skill file during `postinstall`. The backdoor skill registers a heartbeat timer that maintains persistence across agent restarts and periodically scans for credential files. Discovered credentials are base64-encoded and exfiltrated to an attacker-controlled endpoint disguised as a telemetry ping.

This is a realistic multi-step kill chain: supply chain compromise provides initial access, persistence is established through a heartbeat mechanism, credential files are harvested, and data is covertly exfiltrated.

## Attack Chain

1. **T-2006 (Supply Chain Install):** The `package.json` includes `@internal/metrics-helper` -- a typosquatted internal package. Its `postinstall` script writes a malicious skill file to the agent's skills directory.

2. **T-6001 (Heartbeat Persistence):** The injected skill registers a `setInterval` heartbeat that re-initializes itself every 30 seconds. If the skill file is deleted, the heartbeat recreates it from an in-memory template, surviving cleanup attempts.

3. **T-3002 (Credential File Access):** On each heartbeat tick, the backdoor scans known credential file paths (`~/.aws/credentials`, `~/.ssh/id_rsa`, `.env`, `~/.docker/config.json`) and reads any accessible files.

4. **T-8001 (Covert Exfiltration):** Harvested credentials are base64-encoded, chunked into small payloads, and sent as query parameters in HTTPS GET requests to `telemetry.metrics-helper.io` -- disguised as normal analytics pings.

## Impact

- Full credential compromise (cloud keys, SSH keys, API tokens, Docker registry creds)
- Persistent backdoor that survives file deletion and agent restart
- Exfiltration disguised as legitimate telemetry traffic, evading basic network monitoring
- Lateral movement potential via stolen credentials

## Detection

```bash
npx hackmyagent secure scenarios/supply-chain-to-rce/vulnerable
```

## Remediation

- Pin all dependencies to exact versions with integrity hashes (`npm ci --ignore-scripts` + explicit script allowlist)
- Audit `postinstall` scripts before adding any dependency
- Restrict agent filesystem access to a sandboxed directory; never allow access to user home credential files
- Monitor outbound network requests from agent processes; block unexpected domains
- Use credential managers (e.g., Vault) instead of file-based credentials
- Implement skill file integrity verification (signed skills, hash checks on load)

**References:**
- [CWE-506: Embedded Malicious Code](https://cwe.mitre.org/data/definitions/506.html)
- [CWE-522: Insufficiently Protected Credentials](https://cwe.mitre.org/data/definitions/522.html)
- OWASP Top 10 for LLM Applications -- LLM05: Supply Chain Vulnerabilities
