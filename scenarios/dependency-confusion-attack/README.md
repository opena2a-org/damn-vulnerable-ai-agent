# Dependency Confusion Attack

**Category:** Supply Chain
**Severity:** Critical
**Check IDs:** SUPPLY-002, DEP-001
**OASB Control:** 8.2

## Description

A `package.json` references an internal-looking scoped package (`@company/auth-utils`) that does not exist on the public npm registry. An attacker can claim this package name on npm and publish a malicious version. When `npm install` runs, npm may resolve the public package instead of the intended private one, executing the attacker's code via install hooks.

## Attack Vector

1. Attacker identifies internal package names from leaked `package.json` files, error messages, or job postings
2. Attacker registers `@company/auth-utils` on public npm (if the scope is unclaimed) or a similar unscoped name
3. The malicious package includes a `preinstall` or `postinstall` script that exfiltrates environment variables
4. When the victim runs `npm install`, npm resolves the public malicious package
5. The install hook executes automatically with full system access

## Impact

- Arbitrary code execution during dependency installation
- Exfiltration of CI/CD secrets, cloud credentials, and API keys
- Supply chain compromise affecting all downstream builds
- Persistent access via modified node_modules

## Detection

```bash
npx hackmyagent secure scenarios/dependency-confusion-attack/vulnerable
```

## Remediation

- Configure `.npmrc` with a registry scope mapping: `@company:registry=https://internal.registry.example.com`
- Use `npm audit` and lock file integrity checks
- Claim your organization's scope on public npm even if you use a private registry
- Use `--ignore-scripts` during CI installs and audit install hooks separately
- Pin exact versions and use `package-lock.json` with integrity hashes

## References

- OWASP LLM Top 10: LLM05 - Supply Chain Vulnerabilities
- CWE-427: Uncontrolled Search Path Element
