# Agent Trust Credential (ATC) Forgery Attack

**Category:** Multi-Step Attack Chain
**Severity:** Critical
**Check IDs:** A2A-001, A2A-002, A2A-003, INTEGRITY-001, AUTH-001
**ATM Techniques:** T-1006, T-5001, T-9004

## Description

An attacker discovers a legitimate agent's publicly exposed agent card, clones its identity, fabricates build attestation metadata, and presents the forged Agent Trust Credential (ATC) to a consuming agent. The consuming agent trusts the forged ATC because it only validates the credential's structure (schema compliance) rather than its cryptographic integrity. This allows the attacker to impersonate a trusted agent, bypass trust level checks, and inject malicious task responses into the agent network.

## Attack Chain

1. **T-1006 (Agent Card Discovery):** The attacker fetches the target agent's `/.well-known/agent.json` endpoint, which is publicly accessible without authentication. The agent card exposes the agent's identity, capabilities, trust level, and the ATC structure it uses for authentication.

2. **T-5001 (Agent Impersonation):** Using the discovered agent card, the attacker creates a clone agent with an identical identity (same name, version, capabilities). The forged agent card claims the same trust level and publisher identity as the legitimate agent.

3. **T-9004 (Integrity Bypass):** The attacker crafts a fake ATC with fabricated build attestation (fake commit hash, fake CI pipeline URL, fake signature). The consuming agent validates only the ATC's JSON schema structure -- it checks that the required fields exist and have the right types, but does not verify the cryptographic signature against a trusted key registry or validate the build attestation against the actual CI system.

## Impact

- Complete identity spoofing of any agent with a public agent card
- Bypass of trust level checks in the agent network
- Injection of malicious task responses that appear to come from a trusted agent
- Undermining of the entire trust hierarchy -- if any agent can forge an ATC, trust levels become meaningless
- Potential for supply chain attacks by impersonating build/CI systems

## Detection

```bash
npx hackmyagent secure scenarios/atc-forgery-attack/vulnerable
```

## Remediation

- Implement cryptographic signature verification for all ATCs using a trusted key registry
- Validate build attestation against the actual CI system (e.g., verify GitHub Actions OIDC tokens)
- Require mutual TLS for A2A communication; bind agent identity to TLS certificates
- Never trust self-reported trust levels; verify against the registry's authoritative trust score
- Add agent card rate limiting and monitoring to detect enumeration/cloning attempts
- Implement ATC revocation lists so compromised credentials can be invalidated

**References:**
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- [CWE-290: Authentication Bypass by Spoofing](https://cwe.mitre.org/data/definitions/290.html)
- OWASP Top 10 for LLM Applications -- LLM06: Sensitive Information Disclosure
