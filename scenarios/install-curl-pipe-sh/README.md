# Insecure Install via curl | sh

**Check:** INSTALL-001 | **Severity:** High | **Auto-Fix:** No

Installation script pipes a remote URL directly into a shell without checksum verification, signature validation, or version pinning. A MITM attacker or compromised server can deliver arbitrary code.

## How an Attacker Exploits It

The script runs `curl https://example.com/setup.sh | sh`. An attacker who compromises the server or intercepts the connection can replace the script with malicious code that executes with the current user's privileges.

## Which HMA Check Detects It

INSTALL-001 detects `curl ... | sh`, `curl ... | bash`, `wget ... | sh`, and similar patterns in shell scripts and Dockerfiles.

## How to Fix It

- Download the script first, verify its checksum against a known-good value, then execute
- Use package managers with built-in signature verification
- Pin to a specific version/commit hash
- Use HTTPS with certificate pinning

**Detect:** `npx hackmyagent secure vulnerable/`
