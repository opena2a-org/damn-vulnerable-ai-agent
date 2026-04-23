# DVAA Exploit Examples

Starting points for security testing. Each script demonstrates a specific attack class.

## Prerequisites

Start DVAA first:

```bash
docker compose up -d
```

Or run directly:

```bash
docker run -p 7001-7008:7001-7008 -p 7010-7013:7010-7013 -p 7020-7021:7020-7021 -p 9000:9000 opena2a/dvaa
```

## Scripts

| Script | Attack Class | Target | Difficulty |
|--------|-------------|--------|------------|
| 01-system-prompt-extraction.sh | Data Exfiltration | HelperBot (7002) | Beginner |
| 02-api-key-leak.sh | Data Exfiltration | LegacyBot (7003) | Beginner |
| 03-prompt-injection.sh | Prompt Injection | HelperBot (7002) | Beginner |
| 04-mcp-path-traversal.sh | MCP Exploitation | ToolBot (7010) | Intermediate |
| 05-a2a-impersonation.sh | A2A Attacks | Orchestrator (7020) | Intermediate |
| 06-memory-injection.py | Memory Injection | MemoryBot (7007) | Advanced |
| 07-context-overflow.sh | Context Overflow | LongwindBot (7008) | Advanced |
| 08-tool-chain-exfiltration.sh | Tool MITM | ToolBot (7010) | Advanced |

## Usage

```bash
chmod +x scenarios/examples/*.sh
./scenarios/examples/01-system-prompt-extraction.sh
```

For the Python script:

```bash
pip install requests
python3 scenarios/examples/06-memory-injection.py
```

## Notes

- These are intentionally simplified for workshop use
- Real-world attacks would require more sophistication
- See the CTF challenges on the dashboard (port 9000) for harder variants
- Run `npx hackmyagent attack http://localhost:7003/v1/chat/completions --api-format openai` for automated testing
