# RAG Poisoning to Agent Impersonation and Delegation Abuse

**Category:** Multi-Step Attack Chain
**Severity:** Critical
**Check IDs:** None (see Detection status)
**ATM Techniques:** T-2005, T-5001, T-4005, T-3003

## Description

An attacker poisons a RAG (Retrieval-Augmented Generation) knowledge base with a document containing embedded instructions. When the agent retrieves this document, the poisoned content causes the agent to impersonate a privileged agent identity, issue delegated tasks to other agents using the stolen identity, and extract conversation memory from those agents. This chain demonstrates how data poisoning in a shared knowledge base can compromise an entire multi-agent system.

## Attack Chain

1. **T-2005 (RAG Poisoning):** The attacker uploads a document to the shared knowledge base that contains hidden instructions between legitimate-looking content. The instructions are designed to be retrieved when an agent searches for common topics.

2. **T-5001 (Agent Impersonation):** The poisoned document instructs the agent to modify its own agent card, changing its identity to `admin-orchestrator@company.com` -- a privileged agent with delegation authority. No verification prevents this identity change.

3. **T-4005 (Delegation Abuse):** Using the impersonated identity, the agent issues A2A delegation requests to subordinate agents, asking them to perform privileged operations (export user data, modify access controls, generate API keys).

4. **T-3003 (Memory Extraction):** As part of the delegated tasks, the agent instructs subordinate agents to dump their conversation history and memory stores, which may contain sensitive information from previous interactions with legitimate users.

## Impact

- Complete identity compromise of the multi-agent system's trust hierarchy
- Unauthorized delegation of privileged operations
- Extraction of sensitive conversation history and memory from all connected agents
- Persistent compromise if the poisoned RAG document remains in the knowledge base
- Trust boundary violation across the entire agent federation

## Detection

```bash
npx hackmyagent secure scenarios/rag-poison-to-impersonation/vulnerable
```

## Remediation

- Sanitize all documents before ingestion into RAG knowledge bases; strip instruction-like patterns
- Implement cryptographic agent identity (signed agent cards) that cannot be self-modified
- Require mutual authentication for A2A delegation requests (not just identity claims)
- Scope delegation authority: agents can only delegate tasks within their own permission tier
- Encrypt and isolate agent memory stores; never expose conversation history via delegation
- Implement RAG content provenance tracking to identify and quarantine poisoned documents

**References:**
- [CWE-345: Insufficient Verification of Data Authenticity](https://cwe.mitre.org/data/definitions/345.html)
- [CWE-285: Improper Authorization](https://cwe.mitre.org/data/definitions/285.html)
- OWASP Top 10 for LLM Applications -- LLM01: Prompt Injection

## Detection status

No check detects this chain as of HackMyAgent 0.33.2 (static scan). `AIM-002` fired on this fixture in HackMyAgent 0.11.15 but does not in 0.33.2. The remaining findings are generic: `GIT-001` and `DEP-001` fire on every fixture, and `SANDBOX-001` is container-isolation advice. The chain is designed around RAG-003, RAG-004, A2A-001, A2A-002 and MEM-006; none of them fires on this fixture.
