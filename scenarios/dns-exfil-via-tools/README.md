# DNS Exfiltration via Tool Calls

**Check:** NET-008 | **Severity:** High | **Auto-Fix:** No

An AI agent's tool makes DNS lookups with user-controlled subdomains, enabling data exfiltration through DNS queries. Stolen data is encoded as subdomains (e.g., `base64data.attacker.com`), which bypasses most network firewalls and egress filters since DNS traffic is rarely blocked.

**Detect:** `npx hackmyagent secure vulnerable/`
**Fix:** Restrict DNS resolution to known domains. Monitor for high-entropy subdomain queries. Use DNS firewall rules to block suspicious lookups.

**References:**
- [CWE-200: Exposure of Sensitive Information to an Unauthorized Actor](https://cwe.mitre.org/data/definitions/200.html)
- DNS tunneling and exfiltration research
- MITRE ATT&CK T1048.003 (Exfiltration Over Alternative Protocol: DNS)
