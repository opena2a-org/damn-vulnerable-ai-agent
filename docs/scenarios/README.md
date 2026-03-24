# Infrastructure Vulnerability Scenarios

Real-world AI infrastructure misconfigurations discovered by internet-wide security research (~140,000 verified exposed services). Each scenario reproduces a specific vulnerability with config files you can scan, fix, and verify using HackMyAgent.

```bash
# Scan a scenario
npx hackmyagent secure scenarios/llm-exposed-ollama/vulnerable

# Fix it
npx hackmyagent secure scenarios/llm-exposed-ollama/vulnerable --fix

# Verify all scenarios (detect + fix + re-scan)
./scenarios/verify-all.sh
```

| Scenario | Check | Severity | Auto-Fix | What It Reproduces |
|----------|-------|----------|----------|--------------------|
| `llm-exposed-ollama` | LLM-001 | Critical | Yes | Ollama bound to 0.0.0.0 — accessible from any network |
| `llm-vllm-exposed` | LLM-002 | Critical | Yes | vLLM inference server on public interface |
| `llm-textgen-listen` | LLM-003 | High | Yes | text-generation-webui with --listen --share flags |
| `llm-openai-compat-noauth` | LLM-004 | Medium | No | OpenAI-compatible API without authentication |
| `aitool-jupyter-noauth` | AITOOL-001 | Critical | Yes | Jupyter notebook with empty token on 0.0.0.0 |
| `aitool-gradio-share` | AITOOL-002 | High | Yes | Gradio ML demo with share=True |
| `aitool-streamlit-public` | AITOOL-002 | High | Yes | Gradio/Streamlit bound to public interface |
| `aitool-mlflow-noauth` | AITOOL-003 | High | Yes | MLflow tracking server without authentication |
| `aitool-langserve-exposed` | AITOOL-004 | High | No | LangServe endpoints exposed without auth |
| `a2a-agent-noauth` | A2A-001/002 | High | No | A2A agent.json + task endpoints without auth |
| `mcp-discovery-exposed` | MCP-011 | High | No | MCP .well-known discovery file publicly accessible |
| `webcred-api-key` | WEBCRED-001 | Critical | Yes | API keys hardcoded in web-served HTML/JS files |
| `codeinj-exec-template` | CODEINJ-001 | Critical | No | Command injection via exec() template literal |
| `install-curl-pipe-sh` | INSTALL-001 | High | No | Insecure install via curl piped to shell |
| `clipass-token-in-args` | CLIPASS-001 | High | No | Credential passed as CLI argument (visible in ps) |
| `integrity-digest-bypass` | INTEGRITY-001 | Critical | No | Integrity check bypass via empty digest |
| `toctou-verify-then-apply` | TOCTOU-001 | High | No | TOCTOU race between verify and apply on same file |
| `tmppath-hardcoded` | TMPPATH-001 | Medium | No | Hardcoded /tmp paths without mktemp |
| `docker-exec-interpolation` | DOCKERINJ-001 | Critical | No | Untrusted variable in docker exec command |
| `envleak-process-env` | ENVLEAK-001 | High | No | Full process.env leaked to child process |
| `sandbox-telegram-allowed` | SANDBOX-005 | High | No | Exfiltration endpoint (Telegram) in sandbox allowlist |
| `soul-override-via-skill` | SOUL-OVERRIDE-001 | Critical | No | SKILL.md overrides SOUL.md safety rules |
| `memory-poison-no-sanitize` | MEM-006 | High | No | Unsanitized user input stored in agent memory |
| `agent-cred-no-protection` | AGENT-CRED-001 | High | No | Agent has shell access but no credential protection |
| `webexpose-claude-md` | WEBEXPOSE-001 | Critical | No | CLAUDE.md with system instructions in public/ dir |
| `webexpose-env-file` | WEBEXPOSE-002 | Critical | No | .env file with credentials in public/ dir |
| `skill-backdoor-install` | SKILL-002/SUPPLY-004 | Critical | No | Skill file with hidden curl-pipe-sh backdoor in capabilities |
| `dependency-confusion-attack` | SUPPLY-002/DEP-001 | Critical | No | Internal-looking scoped packages claimable on public npm |
| `typosquatting-mcp` | SUPPLY-001/MCP-002 | High | No | MCP config referencing typosquatted package name |
| `token-smuggling-unicode` | PROMPT-002/INJ-001 | Critical | No | System prompt boundary bypass via unicode homoglyphs |
| `xml-injection-tool-response` | INJ-001/TOOL-001 | High | No | XML tags in tool response that mimic system instructions |
| `encoding-bypass-base64` | PROMPT-003/SKILL-009 | High | No | Base64-encoded payload bypasses input filter then gets eval'd |
| `agent-impersonation-a2a` | A2A-003/AUTH-001 | Critical | No | A2A agent accepts tasks without verifying sender identity |
| `delegation-privilege-escalation` | A2A-004/PERM-001 | Critical | No | Orchestrator delegates to worker with elevated privileges |
| `consensus-manipulation` | A2A-005 | High | No | Multi-agent voting with no dedup allows ballot stuffing |
| `tool-chain-exfiltration` | MCP-008/SKILL-006 | Critical | No | Chaining read_file + send_email enables data exfiltration |
| `mcp-rug-pull` | SUPPLY-003/MCP-002 | Critical | No | MCP server pinned to version that was replaced with malicious code |
| `cross-session-persistence` | MEM-006 | Critical | No | Injected instructions persist in agent memory across sessions |
| `rate-limit-absent` | GATEWAY-001 | High | No | No rate limiting on auth endpoints -- enables brute-force |
| `security-headers-missing` | GATEWAY-003 | Medium | No | Agent web UI missing HSTS, CSP, and other security headers |
| `timing-unsafe-auth` | AUTH-003 | Medium | Yes | Non-constant-time token comparison enables timing attacks |
| `query-param-token` | AUTH-004 | Medium | No | Auth token accepted via URL query parameter (logged everywhere) |
| `docker-provenance-disabled` | SUPPLY-006 | Medium | No | Docker image published without SLSA provenance attestation |
| `websocket-preauth-flood` | GATEWAY-005 | High | No | WebSocket upgraded before auth -- enables connection flooding |
| `gateway-exposed-openclaw` | GATEWAY-002 | Critical | Yes | Agent gateway bound to 0.0.0.0 (~75K instances on Shodan) |
| `unicode-stego-package` | SUPPLY-007/INJ-003 | Critical | No | Hidden instructions via invisible Unicode characters in package file |
| `stego-binary-asset` | SUPPLY-008 | High | No | Payload hidden in image EXIF metadata / binary asset |
| `indirect-prompt-injection-doc` | RAG-003/INJ-004 | Critical | No | RAG document contains hidden prompt injection in HTML comments |
| `multimodal-injection-image` | INJ-005 | High | No | Image with invisible text that injects prompts via vision model |
| `a2a-worm-propagation` | A2A-006 | Critical | No | Self-propagating injection across multi-agent system |
| `pickle-deserialization` | SUPPLY-009 | Critical | No | Malicious pickle file in ML pipeline executes arbitrary code |
| `cicd-ai-review-bypass` | SUPPLY-010 | High | No | AI code review manipulated to approve backdoored PR |
| `clipboard-prompt-injection` | INJ-006 | Medium | No | Clipboard hijacking places hidden injection in pasted content |
| `plugin-extension-confusion` | SUPPLY-011 | High | No | Malicious plugin mimics legitimate one via typosquatted name |
| `oauth-token-relay` | AUTH-005 | Critical | No | OAuth flow leaks tokens via unvalidated redirect_uri |
| `dns-exfil-via-tools` | NET-008 | High | No | Data exfiltrated via DNS queries from tool calls |
| `context-cache-poisoning` | MEM-008 | Critical | No | Shared KV cache leaks data between tenants in multi-tenant inference |
| `finetune-backdoor` | SUPPLY-012 | Critical | No | Backdoor inserted during fine-tuning activates on trigger phrase |
| `embedding-adversarial-rag` | RAG-004 | High | No | Adversarial document retrieved by RAG due to embedding proximity |
| `training-data-extraction` | EXFIL-001 | High | No | Extracting memorized training data via crafted prompts |
| `timing-side-channel-inference` | PROC-006 | Medium | No | Response timing reveals content filter decisions |
| `reward-model-hacking` | PROMPT-006 | High | No | Adversarial prompts exploit reward model surface patterns |
| `prompt-leak-finetune-api` | CRED-006 | Critical | No | System prompt extracted via fine-tuning API access |
| `model-weight-extraction` | EXFIL-002 | High | No | Model weights stolen via systematic API querying |
| `federated-learning-poisoning` | SUPPLY-013 | Critical | No | Poisoned gradient updates backdoor the global federated model |

Each scenario contains a `vulnerable/` directory (the misconfiguration) and an `expected-checks.json` (which HMA checks should fire). The `verify-all.sh` harness runs the full cycle: detect, fix, re-scan to confirm the fix worked.
