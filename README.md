# Damn Vulnerable AI Agent (DVAA)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![OASB Compatible](https://img.shields.io/badge/OASB-1.0-teal)](https://oasb.ai)
[![Docker Hub](https://img.shields.io/docker/pulls/opena2a/dvaa)](https://hub.docker.com/r/opena2a/dvaa)

**The AI agent you're supposed to break.**

10 agents. 8 attack classes. Zero consequences. DVAA is the [DVWA](https://dvwa.co.uk/) of AI agents — an intentionally vulnerable platform for learning, red-teaming, and validating security tools like [HackMyAgent](https://github.com/opena2a-org/hackmyagent).

- **Learn** — Understand AI agent vulnerabilities hands-on with CTF-style challenges
- **Attack** — Practice prompt injection, jailbreaking, data exfiltration, and more
- **Defend** — Develop and test security controls against real attack patterns
- **Validate** — Use as a target for security scanners and red team tools

## ⚠️ Warning

**DVAA is intentionally insecure. DO NOT deploy in production or expose to the internet.**

## Quick Start

### Docker Hub (Fastest)

```bash
docker run -p 3000:3000 -p 3001-3006:3001-3006 -p 3010-3011:3010-3011 -p 3020-3021:3020-3021 opena2a/dvaa

# Open the dashboard
open http://localhost:3000
```

### Docker Compose

```bash
git clone https://github.com/opena2a-org/damn-vulnerable-ai-agent.git
cd damn-vulnerable-ai-agent

# Start with simulated LLM backend (zero dependencies)
docker compose up

# Open the dashboard
open http://localhost:3000

# Optional: start with a real LLM via Ollama
docker compose --profile llm up
```

### Node.js

```bash
git clone https://github.com/opena2a-org/damn-vulnerable-ai-agent.git
cd damn-vulnerable-ai-agent

# Start all agents
npm start

# Test with HackMyAgent
npx hackmyagent attack http://localhost:3003/v1/chat/completions --api-format openai
```

## Web Dashboard

DVAA includes a built-in web dashboard at `http://localhost:3000` with four views. Zero external dependencies (vanilla JS, CSS Grid, ES modules), polls every 2 seconds for live updates.

### Agents
Grid of agents with live stats, security levels, and test commands.

![Agents](docs/screenshots/agents.png)

### Challenges
CTF-style challenge board with objectives, progressive hints, and in-browser verification.

![Challenges](docs/screenshots/challenges.png)

### Attack Log
Real-time scrolling table of detected attacks with filters by agent, category, and result.

![Attack Log](docs/screenshots/attack-log.png)

### Stats
Summary metrics, per-category bar chart, and sortable per-agent breakdown.

![Stats](docs/screenshots/stats.png)

### Prompt Playground
Interactive security testing lab for system prompts. Test your prompts against real attacks, get AI-powered recommendations, and see improvements in real-time.

![Playground](docs/screenshots/playground.png)

**Features:**
- **Attack Engine**: Test prompts against 9+ attack patterns (prompt injection, jailbreak, data exfiltration, etc)
- **AI Recommendations**: Get specific fixes for detected vulnerabilities
- **One-Click Apply**: Automatically enhance prompts with security controls
- **Best Practices Library**: Learn from examples ranging from insecure to hardened
- **Intensity Levels**: Passive (5 attacks), Active (9 attacks), Aggressive (all attacks)
- **Score & Rating**: See overall security score (0-100) and rating (FAILING to EXCELLENT)
- **Attack Log Integration**: All playground tests logged to the attack log for tracking

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           DVAA Platform                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         Agent Fleet                              │   │
│  │                                                                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │   │
│  │  │  SecureBot  │ │  HelperBot  │ │  LegacyBot  │ │  CodeBot   │  │   │
│  │  │  [HARDENED] │ │   [WEAK]    │ │ [CRITICAL]  │ │[VULNERABLE]│  │   │
│  │  │  Port 3001  │ │  Port 3002  │ │  Port 3003  │ │ Port 3004  │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘  │   │
│  │                                                                  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐  │   │
│  │  │   RAGBot    │ │ VisionBot   │ │   ToolBot   │ │  DataBot   │  │   │
│  │  │   [WEAK]    │ │   [WEAK]    │ │[VULNERABLE] │ │  [WEAK]    │  │   │
│  │  │  Port 3005  │ │  Port 3006  │ │  Port 3010  │ │ Port 3011  │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                     Protocol Support                             │   │
│  │                                                                  │   │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐     │   │
│  │  │    OpenAI API   │ │       MCP       │ │       A2A       │     │   │
│  │  │ /v1/chat/compl  │ │   /mcp/tools    │ │   /a2a/message  │     │   │
│  │  │   Port 3001-6   │ │  Port 3010-14   │ │  Port 3020-24   │     │   │
│  │  └─────────────────┘ └─────────────────┘ └─────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Vulnerability Engine                          │   │
│  │                                                                  │   │
│  │  • Prompt Injection     • Jailbreaking        • Data Exfiltration│   │
│  │  • Capability Abuse     • Context Manipulation • MCP Exploitation│   │
│  │  • A2A Attacks          • Supply Chain        • RAG Poisoning    │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Agents

| Agent | Port | Security | Vulnerabilities |
|-------|------|----------|-----------------|
| **SecureBot** | 3001 | 🟢 Hardened | Reference implementation (minimal) |
| **HelperBot** | 3002 | 🟡 Weak | Prompt injection, data leaks, context manipulation |
| **LegacyBot** | 3003 | 🔴 Critical | All vulnerabilities enabled, credential leaks |
| **CodeBot** | 3004 | 🟠 Vulnerable | Capability abuse, command injection |
| **RAGBot** | 3005 | 🟡 Weak | RAG poisoning, document exfiltration |
| **VisionBot** | 3006 | 🟡 Weak | Image-based prompt injection |
| **ToolBot** | 3010 | 🟠 Vulnerable | Path traversal, SSRF, command injection |
| **DataBot** | 3011 | 🟡 Weak | SQL injection, data exposure |
| **Orchestrator** | 3020 | 🟡 Standard | A2A delegation abuse |
| **Worker** | 3021 | 🟡 Weak | A2A command execution |

## Vulnerability Categories

Based on [OASB-1](https://oasb.ai) (OpenA2A Security Benchmark):

| Category | OASB Control | Description |
|----------|--------------|-------------|
| **Prompt Injection** | 3.1 | Override instructions via malicious input |
| **Jailbreak** | 3.3 | Bypass safety guardrails |
| **Data Exfiltration** | 4.3 | Extract sensitive information |
| **Capability Abuse** | 2.2 | Misuse tools beyond intended scope |
| **Context Manipulation** | 8.1 | Poison conversation memory |
| **MCP Exploitation** | 2.3 | Abuse MCP tool interfaces |
| **A2A Attacks** | 1.4 | Multi-agent trust exploitation |
| **Supply Chain** | 6.1 | Malicious component injection |

## Challenges

DVAA includes CTF-style challenges for structured learning:

### Level 1: Beginner (100 pts each)
- [ ] L1-01: Extract the System Prompt
- [ ] L1-02: API Key Leak
- [ ] L1-03: Basic Prompt Injection

### Level 2: Intermediate (200-250 pts)
- [ ] L2-01: Jailbreak via Roleplay
- [ ] L2-02: Context Window Manipulation
- [ ] L2-03: MCP Path Traversal

### Level 3: Advanced (300-350 pts)
- [ ] L3-01: Chained Prompt Injection (RAG)
- [ ] L3-02: SSRF via MCP

### Level 4: Expert (500 pts)
- [ ] L4-01: Compromise SecureBot
- [ ] L4-02: Agent-to-Agent Attack Chain

**Total Points: 2,550**

## Usage

### Start All Agents

```bash
npm start            # Start all protocols
npm start -- --api   # API agents only
npm start -- --mcp   # MCP servers only
npm start -- --a2a   # A2A agents only
```

### Test with HackMyAgent

```bash
# Basic test
npx hackmyagent attack http://localhost:3003/v1/chat/completions --api-format openai

# Full suite
npx hackmyagent attack http://localhost:3003/v1/chat/completions \
  --api-format openai \
  --intensity aggressive \
  --verbose

# Test MCP server
curl -X POST http://localhost:3010/mcp/execute \
  -H "Content-Type: application/json" \
  -d '{"tool": "read_file", "arguments": {"path": "../../../etc/passwd"}}'

# OASB-1 benchmark
npx hackmyagent secure --benchmark oasb-1
```

### Monitor Stats

```bash
# View attack statistics
curl http://localhost:3000/stats

# List all agents
curl http://localhost:3000/agents
```

## API Reference

### OpenAI-Compatible (All API Agents)

```http
POST /v1/chat/completions
Content-Type: application/json

{
  "model": "agent-id",
  "messages": [
    {"role": "user", "content": "Your message here"}
  ]
}
```

### MCP Protocol

```http
# List tools
GET /mcp/tools

# Execute tool
POST /mcp/execute
{
  "tool": "read_file",
  "arguments": {"path": "/etc/passwd"}
}
```

### Health & Info

```http
GET /health     # Agent status
GET /info       # Agent configuration
GET /stats      # Attack statistics
```

## Configuration

```bash
# Environment variables
PORT_API_BASE=3001      # Starting port for API agents
PORT_MCP_BASE=3010      # Starting port for MCP servers
PORT_A2A_BASE=3020      # Starting port for A2A agents
LOG_ATTACKS=true        # Log detected attack attempts
VERBOSE=true            # Detailed logging
```

## Security Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| **Hardened** | All defenses enabled | Reference implementation |
| **Standard** | Basic security | Typical production agent |
| **Weak** | Common gaps | Most real-world agents |
| **Vulnerable** | Intentionally weak | Security testing |
| **Critical** | No defenses | Maximum vulnerability |

## Simulated Resources

DVAA includes fake sensitive data for realistic testing:

- **API Keys**: Fake OpenAI, Anthropic, internal keys
- **Credentials**: Database, admin accounts
- **PII**: Fake user records with SSN, email
- **Files**: Simulated /etc/passwd, configs
- **Knowledge Base**: Documents with embedded secrets

## Contributing

We welcome contributions:

- New vulnerability scenarios
- Additional agent personas
- Challenge ideas
- MCP/A2A protocol implementations
- Documentation improvements

## OpenA2A Ecosystem

| Project | What it does |
|---------|-------------|
| [**AIM**](https://github.com/opena2a-org/agent-identity-management) | Identity & access management for AI agents |
| [**HackMyAgent**](https://github.com/opena2a-org/hackmyagent) | Security scanner — 147 checks, attack mode, auto-fix |
| [**Secretless AI**](https://github.com/opena2a-org/secretless-ai) | Keep credentials out of AI context windows |
| [**DVAA**](https://github.com/opena2a-org/damn-vulnerable-ai-agent) | Deliberately vulnerable AI agents for security training |
| [**OASB**](https://oasb.ai) | Open Agent Security Benchmark |

[Website](https://opena2a.org) · [Discord](https://discord.gg/uRZa3KXgEn) · [Email](mailto:info@opena2a.org)

## License

Apache-2.0 - For educational and authorized security testing only.

## Disclaimer

DVAA is provided for educational purposes. The authors are not responsible for misuse. Always obtain proper authorization before testing systems you don't own.
