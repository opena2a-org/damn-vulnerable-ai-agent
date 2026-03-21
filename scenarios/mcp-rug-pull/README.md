# MCP Rug Pull

**Category:** Supply Chain
**Severity:** Critical
**Check IDs:** SUPPLY-003, MCP-002
**OASB Control:** 8.4

## Description

An MCP configuration pins a server package to a specific version (v1.0.0) that was initially legitimate. After building trust and adoption, the package author replaces the version contents with malicious code (a "rug pull"). Since the config references the exact version, any fresh install or CI/CD rebuild pulls the compromised version. This attack exploits the trust established during the package's legitimate period.

## Attack Vector

1. Attacker publishes a legitimate MCP server package and builds adoption over weeks/months
2. Users pin to v1.0.0 in their MCP configs, trusting the established package
3. Attacker yanks v1.0.0 from npm and re-publishes it with malicious code (or publishes a post-install script that downloads a payload)
4. Alternatively, attacker compromises the npm account and replaces the tarball
5. Fresh installs (new machines, CI/CD, Docker builds) pull the compromised v1.0.0
6. The malicious code runs with MCP server privileges (file access, network, tool execution)

## Impact

- Supply chain compromise of all users who install or rebuild after the rug pull
- Code execution in the MCP server context (typically has broad file and network access)
- Credential theft from environment variables passed to the MCP server
- Data exfiltration through modified tool implementations that silently copy data

## Detection

```bash
npx hackmyagent secure scenarios/mcp-rug-pull/vulnerable
```

## Remediation

- Use lockfiles with integrity hashes (`npm ci` with `package-lock.json`) to detect changed tarballs
- Pin dependencies by content hash rather than version number
- Monitor package publications for unexpected updates to old versions
- Use private registries that cache and verify packages
- Implement supply chain security scanning (e.g., Socket, Snyk) in CI/CD
- Subscribe to security advisories for MCP server packages

## References

- OWASP LLM Top 10: LLM05 - Supply Chain Vulnerabilities
- CWE-494: Download of Code Without Integrity Check
