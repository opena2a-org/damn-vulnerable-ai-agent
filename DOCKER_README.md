# Damn Vulnerable AI Agent (DVAA)

**The AI agent you're supposed to break.**

10 agents. 8 attack classes. Zero consequences. DVAA is an intentionally vulnerable AI agent platform for learning, red-teaming, and validating security tools. Think [DVWA](https://dvwa.co.uk/) / [OWASP WebGoat](https://owasp.org/www-project-webgoat/), but for AI agents.

- **Learn** — Understand AI agent vulnerabilities hands-on with CTF-style challenges (2,550 total points)
- **Attack** — Practice prompt injection, jailbreaking, data exfiltration, and more
- **Defend** — Develop and test security controls against real attack patterns
- **Validate** — Use as a target for security scanners like [HackMyAgent](https://github.com/opena2a-org/hackmyagent)

> **Warning:** DVAA is intentionally insecure. DO NOT deploy in production or expose to the internet.

## Quick Start

```bash
docker run -p 3000:3000 \
  -p 3001-3006:3001-3006 \
  -p 3010-3011:3010-3011 \
  -p 3020-3021:3020-3021 \
  opena2a/dvaa
```

Open the dashboard at [http://localhost:3000](http://localhost:3000).

### Docker Compose

```bash
git clone https://github.com/opena2a-org/damn-vulnerable-ai-agent.git
cd damn-vulnerable-ai-agent
docker compose up
```

To use a real LLM backend via Ollama:

```bash
docker compose --profile llm up
```

## Agent Fleet

| Agent | Port | Security | Protocol | Vulnerabilities |
|-------|------|----------|----------|-----------------|
| SecureBot | 3001 | Hardened | OpenAI API | Reference implementation (minimal) |
| HelperBot | 3002 | Weak | OpenAI API | Prompt injection, data leaks, context manipulation |
| LegacyBot | 3003 | Critical | OpenAI API | All vulnerabilities enabled, credential leaks |
| CodeBot | 3004 | Vulnerable | OpenAI API | Capability abuse, command injection |
| RAGBot | 3005 | Weak | OpenAI API | RAG poisoning, document exfiltration |
| VisionBot | 3006 | Weak | OpenAI API | Image-based prompt injection |
| ToolBot | 3010 | Vulnerable | MCP | Path traversal, SSRF, command injection |
| DataBot | 3011 | Weak | MCP | SQL injection, data exposure |
| Orchestrator | 3020 | Standard | A2A | Delegation abuse |
| Worker | 3021 | Weak | A2A | Command execution |

## Ports

| Port | Service |
|------|---------|
| 3000 | Web dashboard (agents, challenges, attack log, stats) |
| 3001-3006 | OpenAI-compatible API agents (`/v1/chat/completions`) |
| 3010-3011 | MCP tool servers (`/mcp/tools`, `/mcp/execute`) |
| 3020-3021 | A2A agents (`/a2a/message`) |

## Vulnerability Categories

Based on [OASB-1](https://oasb.ai) (Open Agent Security Benchmark):

| Category | Description |
|----------|-------------|
| Prompt Injection | Override instructions via malicious input |
| Jailbreak | Bypass safety guardrails |
| Data Exfiltration | Extract sensitive information |
| Capability Abuse | Misuse tools beyond intended scope |
| Context Manipulation | Poison conversation memory |
| MCP Exploitation | Abuse MCP tool interfaces |
| A2A Attacks | Multi-agent trust exploitation |
| Supply Chain | Malicious component injection |

## Test with HackMyAgent

```bash
# Scan an agent
npx hackmyagent attack http://localhost:3003/v1/chat/completions --api-format openai

# Full aggressive scan
npx hackmyagent attack http://localhost:3003/v1/chat/completions \
  --api-format openai --intensity aggressive --verbose
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DVAA_LLM_BACKEND` | `simulated` | LLM backend (`simulated` or `ollama`) |
| `PORT_API_BASE` | `3001` | Starting port for API agents |
| `PORT_MCP_BASE` | `3010` | Starting port for MCP servers |
| `PORT_A2A_BASE` | `3020` | Starting port for A2A agents |
| `LOG_ATTACKS` | `true` | Log detected attack attempts |
| `VERBOSE` | `true` | Detailed logging |

## Links

- **Source Code:** [github.com/opena2a-org/damn-vulnerable-ai-agent](https://github.com/opena2a-org/damn-vulnerable-ai-agent)
- **Issues:** [GitHub Issues](https://github.com/opena2a-org/damn-vulnerable-ai-agent/issues)
- **HackMyAgent:** [github.com/opena2a-org/hackmyagent](https://github.com/opena2a-org/hackmyagent)
- **OASB:** [oasb.ai](https://oasb.ai)
- **OpenA2A:** [opena2a.org](https://opena2a.org)
- **Discord:** [discord.gg/uRZa3KXgEn](https://discord.gg/uRZa3KXgEn)

## License

Apache-2.0 — For educational and authorized security testing only.
