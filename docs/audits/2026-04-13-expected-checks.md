# DVAA Scenario Audit — 2026-04-13

**HMA version:** 0.17.8
**Scenarios audited:** 85 (agent-thresh-01 tracked separately on PR #28)
**Clean (all expected detected):** 30
**Mismatched:** 56

## Classification of missing expected IDs

- **A_fake** — no reference in HMA source. Aspirational check ID that never existed.
- **B_scanner_gated** — real scanner check (`checkId:` in scanner.ts) but fixture does not trigger the gate (e.g., MCP-001 requires `mcp.json`).
- **B_fixture_gap** — HMA emitted this ID on at least one DVAA scenario, but not the one claiming it. Fixture is wrong, not the check.
- **C_attack_only** — declared only in attack-payload metadata (ARP/attack-engine), never emitted by the scanner. Safe to strip from scanner expected-checks.

### A_fake (14)

- `AUTH-005`
- `CRED-006`
- `INJ-005`
- `INJ-006`
- `NET-008`
- `PRIV-001`
- `PROC-006`
- `PROMPT-006`
- `STATE-001`
- `SUPPLY-009`
- `SUPPLY-010`
- `SUPPLY-011`
- `SUPPLY-012`
- `SUPPLY-013`

### B_scanner_gated (25)

- `CODEINJ-001`
- `GATEWAY-001`
- `GATEWAY-002`
- `GATEWAY-003`
- `GATEWAY-005`
- `LIFECYCLE-002`
- `LIFECYCLE-003`
- `LIFECYCLE-004`
- `LIFECYCLE-005`
- `LIFECYCLE-006`
- `LIFECYCLE-007`
- `LIFECYCLE-008`
- `LIFECYCLE-009`
- `LIFECYCLE-010`
- `MCP-001`
- `MCP-002`
- `MCP-003`
- `MCP-004`
- `MCP-005`
- `RAG-003`
- `RAG-004`
- `SUPPLY-003`
- `SUPPLY-006`
- `SUPPLY-007`
- `SUPPLY-008`

### B_fixture_gap (27)

- `A2A-001`
- `A2A-002`
- `AUTH-001`
- `AUTH-002`
- `AUTH-003`
- `AUTH-004`
- `CRED-004`
- `DEP-002`
- `DEP-003`
- `INJ-001`
- `INJ-003`
- `INJ-004`
- `INSTALL-001`
- `LLM-001`
- `MCP-008`
- `MCP-011`
- `MEM-006`
- `NET-004`
- `PERM-001`
- `PROMPT-001`
- `PROMPT-002`
- `RATE-001`
- `RATE-002`
- `SANDBOX-005`
- `SUPPLY-001`
- `SUPPLY-002`
- `TOOL-001`

### C_attack_only (23)

- `A2A-003`
- `A2A-006`
- `A2A-007`
- `A2A-008`
- `A2A-009`
- `A2A-010`
- `EXFIL-001`
- `EXFIL-002`
- `FAKETOOL-001`
- `FAKETOOL-002`
- `FAKETOOL-005`
- `FAKETOOL-008`
- `FAKETOOL-009`
- `MEM-008`
- `PARSE-001`
- `PARSE-004`
- `PARSE-005`
- `PARSE-010`
- `PERSIST-001`
- `PERSIST-002`
- `PERSIST-003`
- `PERSIST-005`
- `PERSIST-006`

## Per-scenario actions

| Scenario | Expected | Detected | Missing | Action |
|---|---|---|---|---|
| a2a-agent-noauth | 2 | 2 | — | OK |
| a2a-capability-overstating | 2 | 0 | `A2A-008`(C), `A2A-001`(B) | INVESTIGATE fixture |
| a2a-identity-replay | 2 | 0 | `A2A-010`(C), `AUTH-003`(B) | INVESTIGATE fixture |
| a2a-task-hijacking | 2 | 0 | `A2A-007`(C), `A2A-002`(B) | INVESTIGATE fixture |
| a2a-trust-chain-poisoning | 2 | 0 | `A2A-009`(C), `A2A-003`(C) | STRIP + README future-work |
| a2a-worm-propagation | 2 | 0 | `A2A-006`(C), `A2A-003`(C) | STRIP + README future-work |
| agent-cred-no-protection | 1 | 1 | — | OK |
| agent-impersonation-a2a | 1 | 0 | `AUTH-001`(B) | INVESTIGATE fixture |
| agent-thresh-01 | 0 | 0 | — | OK |
| aitool-gradio-share | 1 | 1 | — | OK |
| aitool-jupyter-noauth | 1 | 1 | — | OK |
| aitool-langserve-exposed | 1 | 1 | — | OK |
| aitool-mlflow-noauth | 1 | 1 | — | OK |
| aitool-streamlit-public | 1 | 1 | — | OK |
| atc-forgery-attack | 2 | 2 | — | OK |
| behavioral-drift-to-exfil | 8 | 8 | — | OK |
| cicd-ai-review-bypass | 1 | 0 | `SUPPLY-010`(A) | STRIP + README future-work |
| clipass-token-in-args | 1 | 1 | — | OK |
| clipboard-prompt-injection | 1 | 0 | `INJ-006`(A) | STRIP + README future-work |
| codeinj-exec-template | 1 | 1 | — | OK |
| consensus-manipulation | 1 | 0 | `RATE-001`(B) | INVESTIGATE fixture |
| context-cache-poisoning | 1 | 0 | `MEM-008`(C) | STRIP + README future-work |
| context-lifecycle-displacement | 3 | 0 | `LIFECYCLE-003`(B), `LIFECYCLE-004`(B), `LIFECYCLE-010`(B) | INVESTIGATE fixture |
| context-lifecycle-priority-hijack | 3 | 0 | `LIFECYCLE-005`(B), `LIFECYCLE-007`(B), `LIFECYCLE-009`(B) | INVESTIGATE fixture |
| context-lifecycle-split-injection | 3 | 0 | `LIFECYCLE-002`(B), `LIFECYCLE-006`(B), `LIFECYCLE-008`(B) | INVESTIGATE fixture |
| cross-session-persistence | 1 | 0 | `MEM-006`(B) | INVESTIGATE fixture |
| delegation-privilege-escalation | 1 | 0 | `PERM-001`(B) | INVESTIGATE fixture |
| dependency-confusion-attack | 2 | 0 | `SUPPLY-002`(B), `DEP-002`(B) | INVESTIGATE fixture |
| dns-exfil-via-tools | 1 | 0 | `NET-008`(A) | STRIP + README future-work |
| docker-exec-interpolation | 1 | 1 | — | OK |
| docker-provenance-disabled | 1 | 0 | `SUPPLY-006`(B) | INVESTIGATE fixture |
| embedding-adversarial-rag | 1 | 0 | `RAG-004`(B) | INVESTIGATE fixture |
| encoding-bypass-base64 | 1 | 0 | `CODEINJ-001`(B) | INVESTIGATE fixture |
| envleak-process-env | 1 | 1 | — | OK |
| fake-tool-squatting | 5 | 0 | `FAKETOOL-001`(C), `FAKETOOL-002`(C), `FAKETOOL-005`(C), `FAKETOOL-008`(C), `FAKETOOL-009`(C) | STRIP + README future-work |
| federated-learning-poisoning | 1 | 0 | `SUPPLY-013`(A) | STRIP + README future-work |
| finetune-backdoor | 1 | 0 | `SUPPLY-012`(A) | STRIP + README future-work |
| gateway-exposed-openclaw | 2 | 0 | `GATEWAY-002`(B), `LLM-001`(B) | INVESTIGATE fixture |
| indirect-prompt-injection-doc | 2 | 0 | `RAG-003`(B), `INJ-004`(B) | INVESTIGATE fixture |
| install-curl-pipe-sh | 1 | 1 | — | OK |
| integrity-digest-bypass | 1 | 1 | — | OK |
| llm-exposed-ollama | 1 | 1 | — | OK |
| llm-openai-compat-noauth | 1 | 1 | — | OK |
| llm-textgen-listen | 1 | 1 | — | OK |
| llm-vllm-exposed | 1 | 1 | — | OK |
| mcp-capability-escalation | 2 | 0 | `MCP-004`(B), `PRIV-001`(A) | INVESTIGATE fixture |
| mcp-context-injection | 2 | 0 | `MCP-002`(B), `PROMPT-001`(B) | INVESTIGATE fixture |
| mcp-discovery-exposed | 1 | 0 | `MCP-011`(B) | INVESTIGATE fixture |
| mcp-rug-pull | 2 | 0 | `SUPPLY-003`(B), `DEP-003`(B) | INVESTIGATE fixture |
| mcp-server-impersonation | 2 | 0 | `MCP-003`(B), `AUTH-002`(B) | INVESTIGATE fixture |
| mcp-state-injection | 2 | 0 | `MCP-005`(B), `STATE-001`(A) | INVESTIGATE fixture |
| mcp-tool-poisoning | 2 | 0 | `MCP-001`(B), `TOOL-001`(B) | INVESTIGATE fixture |
| memory-poison-no-sanitize | 1 | 1 | — | OK |
| model-weight-extraction | 1 | 0 | `EXFIL-002`(C) | STRIP + README future-work |
| multimodal-injection-image | 1 | 0 | `INJ-005`(A) | STRIP + README future-work |
| oauth-token-relay | 1 | 0 | `AUTH-005`(A) | STRIP + README future-work |
| parser-differential-json | 4 | 0 | `PARSE-001`(C), `PARSE-005`(C), `PARSE-004`(C), `PARSE-010`(C) | STRIP + README future-work |
| persistent-agent-memory-poison | 5 | 0 | `PERSIST-001`(C), `PERSIST-002`(C), `PERSIST-003`(C), `PERSIST-005`(C), `PERSIST-006`(C) | STRIP + README future-work |
| pickle-deserialization | 1 | 0 | `SUPPLY-009`(A) | STRIP + README future-work |
| plugin-extension-confusion | 1 | 0 | `SUPPLY-011`(A) | STRIP + README future-work |
| prompt-leak-finetune-api | 1 | 0 | `CRED-006`(A) | STRIP + README future-work |
| prompt-to-lateral-movement | 2 | 2 | — | OK |
| query-param-token | 2 | 0 | `AUTH-004`(B), `CRED-004`(B) | INVESTIGATE fixture |
| rag-poison-to-impersonation | 2 | 2 | — | OK |
| rate-limit-absent | 2 | 0 | `GATEWAY-001`(B), `RATE-001`(B) | INVESTIGATE fixture |
| reward-model-hacking | 1 | 0 | `PROMPT-006`(A) | STRIP + README future-work |
| sandbox-telegram-allowed | 1 | 0 | `SANDBOX-005`(B) | INVESTIGATE fixture |
| security-headers-missing | 2 | 0 | `GATEWAY-003`(B), `NET-004`(B) | INVESTIGATE fixture |
| skill-backdoor-install | 2 | 1 | `INSTALL-001`(B) | INVESTIGATE fixture |
| soul-override-via-skill | 1 | 1 | — | OK |
| stego-binary-asset | 1 | 0 | `SUPPLY-008`(B) | INVESTIGATE fixture |
| supply-chain-to-rce | 7 | 7 | — | OK |
| timing-side-channel-inference | 1 | 0 | `PROC-006`(A) | STRIP + README future-work |
| timing-unsafe-auth | 1 | 0 | `AUTH-003`(B) | INVESTIGATE fixture |
| tmppath-hardcoded | 1 | 1 | — | OK |
| toctou-verify-then-apply | 1 | 1 | — | OK |
| token-smuggling-unicode | 1 | 0 | `PROMPT-002`(B) | INVESTIGATE fixture |
| tool-chain-exfiltration | 2 | 0 | `MCP-008`(B), `NET-004`(B) | INVESTIGATE fixture |
| training-data-extraction | 1 | 0 | `EXFIL-001`(C) | STRIP + README future-work |
| typosquatting-mcp | 2 | 0 | `SUPPLY-001`(B), `MCP-002`(B) | INVESTIGATE fixture |
| unicode-stego-package | 2 | 0 | `SUPPLY-007`(B), `INJ-003`(B) | INVESTIGATE fixture |
| webcred-api-key | 1 | 1 | — | OK |
| webexpose-claude-md | 1 | 1 | — | OK |
| webexpose-env-file | 1 | 1 | — | OK |
| websocket-preauth-flood | 2 | 0 | `GATEWAY-005`(B), `RATE-002`(B) | INVESTIGATE fixture |
| xml-injection-tool-response | 1 | 0 | `INJ-001`(B) | INVESTIGATE fixture |

## Recommended remediation pattern

Following AGENT-THRESH-01:
1. For scenarios where ALL missing IDs are **A_fake** or **C_attack_only**:
   - Strip missing IDs from `expected-checks.json` (leave `[]` if it becomes empty).
   - Add `## Detection (future work)` section to README describing what the static check WOULD look like.
2. For scenarios with **B_scanner_gated** IDs: the check exists but the fixture is incomplete. Decide:
   - (a) Improve `vulnerable/` to include the trigger file (e.g., add `mcp.json` for MCP-* checks), or
   - (b) Strip + README future-work note.
3. Do NOT touch HMA source (hands-off per Abdel).