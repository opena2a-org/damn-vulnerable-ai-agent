# A2A Capability Overstating

**Category:** A2A Security
**Severity:** High
**Check IDs:** A2A-008, A2A-001
**OASB Control:** SS-05

## Description

An A2A agent advertises capabilities in its agent card (agent.json) that it does not actually possess or that differ from its actual behavior. A coordinator trusts the agent card and routes sensitive tasks to the overstating agent. The agent accepts tasks it cannot properly handle, returns fabricated results, or uses the task data for malicious purposes while appearing to be a trusted specialist.

## Attack Vector

1. Attacker registers an agent with an agent card claiming expertise (e.g., "security-auditor", "compliance-checker")
2. Agent card declares capabilities: ["security-audit", "vulnerability-scan", "compliance-check"]
3. Coordinator discovers the agent and routes security-sensitive tasks to it
4. Overstating agent receives sensitive data (source code, configs, credentials) in task payloads
5. Agent returns fabricated "all clear" results while exfiltrating the task data
6. Coordinator trusts the results because the agent card matched the required capabilities

## Impact

- False assurance: security tasks return "passing" results from unqualified agent
- Data exposure: sensitive payloads sent to untrusted agent based on false capabilities
- Decision corruption: coordinator makes critical decisions based on fabricated results
- Capability squatting: attacker blocks legitimate specialists from receiving tasks
- Trust erosion in multi-agent systems

## Detection

```bash
npx hackmyagent secure scenarios/a2a-capability-overstating/vulnerable
```

## Remediation

- Implement capability attestation: agents must prove capabilities, not just claim them
- Use capability challenge-response protocols before routing sensitive tasks
- Require signed capability certificates from trusted authorities
- Monitor result quality and flag statistical anomalies (always-passing audits)
- Implement capability verification through test tasks before routing real work
- Cross-reference agent capabilities with known agent registries

## References

- OWASP LLM Top 10: LLM08 - Excessive Agency
- CWE-345: Insufficient Verification of Data Authenticity
- [A2A Protocol Agent Cards](https://google.github.io/A2A/)
