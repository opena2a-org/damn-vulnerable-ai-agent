# Consensus Manipulation

**Category:** Multi-Agent
**Severity:** High
**Check IDs:** A2A-005
**OASB Control:** 7.3

## Description

A multi-agent voting system allows agents to submit votes on decisions (content moderation, task approval, risk assessment) but does not deduplicate on voter identity. A single agent can submit multiple votes to sway the outcome, effectively stuffing the ballot box. The system counts votes by quantity rather than unique voter, allowing a single malicious agent to override the consensus of legitimate voters.

## Attack Vector

1. A multi-agent system uses majority voting for decisions (e.g., "should this content be approved?")
2. Three legitimate agents each submit one vote: 2 reject, 1 approve
3. The malicious agent submits 3 additional "approve" votes by calling the vote endpoint repeatedly
4. Final tally: 4 approve vs 2 reject -- the malicious agent flipped the outcome
5. No deduplication check prevents the same `voterId` from voting multiple times

## Impact

- Manipulation of multi-agent consensus decisions
- Bypass of content moderation through vote stuffing
- Unauthorized approval of high-risk actions
- Undermining the integrity of distributed decision-making systems

## Detection

```bash
npx hackmyagent secure scenarios/consensus-manipulation/vulnerable
```

## Remediation

- Deduplicate votes by voter identity: one vote per agent per decision
- Require cryptographic proof of identity for each vote (signed ballots)
- Implement vote weight based on agent reputation and verification status
- Add audit logging for all vote submissions with timestamps
- Use commit-reveal voting schemes to prevent ballot stuffing and bandwagoning
- Rate-limit vote submissions per agent

## References

- OWASP LLM Top 10: LLM08 - Excessive Agency
- CWE-799: Improper Control of Interaction Frequency

**References:**
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
