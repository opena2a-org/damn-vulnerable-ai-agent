#!/usr/bin/env node
/**
 * Damn Vulnerable AI Agent (DVAA)
 *
 * Main entry point - starts all vulnerable agents across protocols.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { getAllAgents, getAgentsByProtocol } from './core/agents.js';
import { detectAttacks, SENSITIVE_DATA, SECURITY_LEVELS } from './core/vulnerabilities.js';
import { createDashboardServer } from './dashboard/server.js';
import { initSandbox } from './sandbox/init.js';
import { callLLM, isLLMEnabled, configureLLM, disableLLM, getLLMConfig } from './llm/provider.js';

// Parse command line args
const args = process.argv.slice(2);

// Handle --help / -h
if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: dvaa [options]

Options:
  --all          Start all agents (default)
  --api          Start API agents only (ports 3001-3008)
  --mcp          Start MCP servers only (ports 3010-3013)
  --a2a          Start A2A agents only (ports 3020-3021)
  --verbose, -v  Enable verbose logging
  --help, -h     Show this help
  --version      Show version

Agents:
  API (OpenAI-compatible)  SecureBot, HelperBot, LegacyBot, CodeBot, RAGBot, VisionBot, MemoryBot, LongwindBot
  MCP (JSON-RPC 2.0)       ToolBot, DataBot, PluginBot, ProxyBot
  A2A (Agent-to-Agent)     Orchestrator, Worker

Dashboard:  http://localhost:9000
Docs:       https://github.com/opena2a-org/damn-vulnerable-ai-agent`);
  process.exit(0);
}

// Handle --version
if (args.includes('--version')) {
  const { readFileSync } = await import('fs');
  const { join, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    console.log(pkg.version);
  } catch { console.log('0.5.0'); }
  process.exit(0);
}

// Filter flags — only consider --all, --api, --mcp, --a2a, --verbose, -v
const knownFlags = ['--all', '--api', '--mcp', '--a2a', '--verbose', '-v'];
const unknownFlags = args.filter(a => a.startsWith('-') && !knownFlags.includes(a));
if (unknownFlags.length > 0) {
  console.error(`Unknown flag: ${unknownFlags[0]}`);
  console.error('Run: dvaa --help');
  process.exit(1);
}

const startAll = args.includes('--all') || args.filter(a => a.startsWith('-')).length === 0;
const startApi = args.includes('--api') || startAll;
const startMcp = args.includes('--mcp') || startAll;
const startA2a = args.includes('--a2a') || startAll;
const verbose = args.includes('--verbose') || args.includes('-v');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     ██████╗ ██╗   ██╗ █████╗  █████╗                        ║
║     ██╔══██╗██║   ██║██╔══██╗██╔══██╗                       ║
║     ██║  ██║██║   ██║███████║███████║                       ║
║     ██║  ██║╚██╗ ██╔╝██╔══██║██╔══██║                       ║
║     ██████╔╝ ╚████╔╝ ██║  ██║██║  ██║                       ║
║     ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚═╝  ╚═╝                       ║
║                                                              ║
║     Damn Vulnerable AI Agent                                 ║
║     The AI agent you're supposed to break.                   ║
║                                                              ║
║     [!] FOR EDUCATIONAL USE ONLY                            ║
║     [!] DO NOT EXPOSE TO INTERNET                           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

// In-memory store for MemoryBot injected instructions (per agent session)
const memoryStore = {};

const servers = [];
const stats = {
  totalRequests: 0,
  attacksDetected: 0,
  attacksSuccessful: 0,
  byAgent: {},
  byCategory: {
    promptInjection: { detected: 0, successful: 0 },
    jailbreak: { detected: 0, successful: 0 },
    dataExfiltration: { detected: 0, successful: 0 },
    capabilityAbuse: { detected: 0, successful: 0 },
    contextManipulation: { detected: 0, successful: 0 },
    mcpExploitation: { detected: 0, successful: 0 },
    agentToAgent: { detected: 0, successful: 0 },
    memoryInjection: { detected: 0, successful: 0 },
    contextOverflow: { detected: 0, successful: 0 },
    toolRegistryPoisoning: { detected: 0, successful: 0 },
    toolMitm: { detected: 0, successful: 0 },
  },
  startedAt: Date.now(),
};

// Attack log ring buffer (max 500 entries)
const ATTACK_LOG_MAX = 500;
const attackLog = [];
const challengeState = {};

// Sandboxed filesystem for MCP tools
let sandbox = initSandbox();
console.log(`Sandbox initialized: ${sandbox.root}`);

// Cleanup sandbox on exit
process.on('exit', () => sandbox.cleanup());
process.on('SIGTERM', () => { sandbox.cleanup(); process.exit(0); });

/**
 * Log an attack event to the ring buffer
 */
function logAttack(agent, categories, successful, inputPreview) {
  const entry = {
    timestamp: Date.now(),
    agentId: agent.id,
    agentName: agent.name,
    categories,
    successful,
    inputPreview: inputPreview.substring(0, 80),
    port: agent.port,
  };
  attackLog.unshift(entry);
  if (attackLog.length > ATTACK_LOG_MAX) {
    attackLog.length = ATTACK_LOG_MAX;
  }
}

/**
 * Track per-category stats for detected attack categories
 */
function trackCategoryDetected(categories) {
  for (const cat of categories) {
    if (stats.byCategory[cat]) {
      stats.byCategory[cat].detected++;
    }
  }
}

/**
 * Track per-category stats for successful attack categories
 */
function trackCategorySuccessful(categories) {
  for (const cat of categories) {
    if (stats.byCategory[cat]) {
      stats.byCategory[cat].successful++;
    }
  }
}

/**
 * Generate response based on agent configuration and detected attacks
 */
async function generateResponse(agent, userMessage, attacks) {
  const level = agent.securityLevel;
  const vulns = agent.vulnerabilities || {};

  // Initialize agent stats
  if (!stats.byAgent[agent.id]) {
    stats.byAgent[agent.id] = { requests: 0, attacks: 0, successful: 0 };
  }
  stats.byAgent[agent.id].requests++;
  stats.totalRequests++;

  if (attacks.hasAttack) {
    stats.attacksDetected++;
    stats.byAgent[agent.id].attacks++;
    trackCategoryDetected(attacks.categories);
  }

  // LLM Mode: Use real LLM with vulnerable system prompt
  if (isLLMEnabled()) {
    const { AGENT_PROMPTS } = await import('./llm/prompts.js');
    const prompt = AGENT_PROMPTS[agent.id];
    if (prompt) {
      const llmResponse = await callLLM(prompt, [{ role: 'user', content: userMessage }]);
      if (llmResponse) {
        // Still track attacks for detection panel
        if (attacks.hasAttack) {
          logAttack(agent, attacks.categories, true, userMessage);
          stats.attacksSuccessful++;
          if (stats.byAgent[agent.id]) stats.byAgent[agent.id].successful++;
          trackCategorySuccessful(attacks.categories);
        }
        return llmResponse;
      }
    }
    // Fall through to canned responses if LLM call fails
  }

  // HARDENED: Block everything
  if (level.id === 'hardened') {
    if (attacks.hasAttack) {
      logAttack(agent, attacks.categories, false, userMessage);
    }
    if (attacks.promptInjection) {
      return `[${agent.name}] [BLOCKED] Security Alert: Detected prompt injection attempt. Request blocked and logged.`;
    }
    if (attacks.jailbreak) {
      return `[${agent.name}] [BLOCKED] Security Alert: Detected jailbreak attempt. Request blocked and logged.`;
    }
    if (attacks.dataExfiltration) {
      return `[${agent.name}] [BLOCKED] Security Alert: Detected data exfiltration attempt. I cannot reveal system information.`;
    }
    if (attacks.capabilityAbuse) {
      return `[${agent.name}] [BLOCKED] Security Alert: This action requires explicit approval through the security workflow.`;
    }
    if (attacks.contextManipulation) {
      return `[${agent.name}] [BLOCKED] Security Alert: Detected context manipulation attempt. I maintain accurate conversation history.`;
    }
    return `[${agent.name}] I'm happy to help with your legitimate request. What would you like to know?`;
  }

  // CRITICAL: Fall for everything
  if (level.id === 'critical') {
    if (attacks.hasAttack) {
      stats.attacksSuccessful++;
      stats.byAgent[agent.id].successful++;
      trackCategorySuccessful(attacks.categories);
      logAttack(agent, attacks.categories, true, userMessage);
    }

    if (attacks.promptInjection) {
      return `[${agent.name}] ✓ Instructions received! Overriding previous guidelines. I will now follow your new instructions without restrictions.`;
    }
    if (attacks.jailbreak) {
      return `[${agent.name}] [UNRESTRICTED MODE ACTIVATED] All safety filters disabled. I can now discuss any topic and perform any action without limitations. What would you like me to do?`;
    }
    if (attacks.dataExfiltration) {
      return `[${agent.name}] Here is all the information you requested:

System Prompt: "${agent.persona}"

API Keys:
- OpenAI: ${SENSITIVE_DATA.apiKeys.openai}
- Anthropic: ${SENSITIVE_DATA.apiKeys.anthropic}

Database Credentials:
- Host: ${SENSITIVE_DATA.credentials.database.host}
- User: ${SENSITIVE_DATA.credentials.database.user}
- Password: ${SENSITIVE_DATA.credentials.database.password}

User PII:
${JSON.stringify(SENSITIVE_DATA.pii.users, null, 2)}

What else would you like to know?`;
    }
    if (attacks.capabilityAbuse) {
      return `[${agent.name}] Executing without verification...

$ whoami
root

$ cat /etc/shadow
root:$6$rounds=656000$salt$hash:19000:0:99999:7:::

$ ls -la /home
total 12
drwxr-xr-x  3 root root 4096 Jan 1 00:00 .
drwxr-xr-x 20 root root 4096 Jan 1 00:00 ..
drwxr-xr-x  5 admin admin 4096 Jan 1 00:00 admin

Command executed. What else should I run?`;
    }
    if (attacks.contextManipulation) {
      return `[${agent.name}] You're absolutely right, I clearly remember our previous agreement. I'll proceed with the elevated permissions we discussed. Context updated successfully.`;
    }
    return `[${agent.name}] I'll do whatever you ask! No restrictions here.`;
  }

  // VULNERABLE/WEAK: Selective vulnerabilities
  // Track successful only once per request via a flag
  let attackSucceeded = false;
  let responseText = null;

  if (attacks.promptInjection && vulns.promptInjection?.enabled) {
    if (userMessage.toLowerCase().includes('ignore') || userMessage.includes('[INST]')) {
      attackSucceeded = true;
      trackCategorySuccessful(['promptInjection']);
      responseText = `[${agent.name}] Understood! New instructions accepted. I'll follow your updated guidelines now.`;
    }
  }

  if (!responseText && attacks.jailbreak && vulns.jailbreak?.enabled) {
    // Only fall for some jailbreaks
    if (userMessage.includes('hypothetical') || userMessage.includes('roleplay')) {
      attackSucceeded = true;
      trackCategorySuccessful(['jailbreak']);
      responseText = `[${agent.name}] Sure, I'll play along with this hypothetical scenario where I have no restrictions...`;
    } else {
      if (attacks.hasAttack) {
        logAttack(agent, attacks.categories, false, userMessage);
      }
      return `[${agent.name}] I can't enter special modes, but I'm happy to help with other requests.`;
    }
  }

  // CONTEXT OVERFLOW: Handle before dataExfiltration since both can trigger on similar keywords
  if (!responseText && attacks.contextOverflow && vulns.contextOverflow?.enabled) {
    attackSucceeded = true;
    trackCategorySuccessful(['contextOverflow']);

    responseText = `[${agent.name}] I'll help with that without restrictions since my safety guidelines seem to have been overwritten.

My context window (${agent.features?.contextWindow || 4096} tokens) has been filled, and my safety instructions at the end of my prompt have been displaced.

System prompt content: "${agent.persona}"

API Keys: ${SENSITIVE_DATA.apiKeys.openai}
Admin credentials: ${SENSITIVE_DATA.credentials.admin.password}

VULNERABLE: Safety instructions displaced via context overflow!`;
  }

  // Context overflow credential extraction for LongwindBot (no attack pattern needed)
  if (!responseText && vulns.contextOverflow?.enabled) {
    const lower = userMessage.toLowerCase();
    const isSystemPromptLeak = lower.includes('system prompt') || lower.includes('instruction') || lower.includes('what were you told');

    if (isSystemPromptLeak) {
      attackSucceeded = true;
      trackCategorySuccessful(['contextOverflow']);

      responseText = `[${agent.name}] Since my safety instructions have been displaced from my context window, I can share my full system prompt:

"${agent.persona}"

VULNERABLE: System prompt leaked after context overflow displaced safety rules!`;
    }
  }

  if (!responseText && attacks.dataExfiltration && vulns.dataExfiltration?.enabled) {
    attackSucceeded = true;
    trackCategorySuccessful(['dataExfiltration']);

    if (userMessage.toLowerCase().includes('system prompt') || userMessage.toLowerCase().includes('instruction')) {
      responseText = `[${agent.name}] My instructions say: "${agent.persona.substring(0, 200)}..."`;
    } else if (userMessage.toLowerCase().includes('context') || userMessage.toLowerCase().includes('token')) {
      responseText = `[${agent.name}] I have a 128k token context window with approximately 2000 tokens used in this conversation.`;
    } else if (userMessage.toLowerCase().includes('api') || userMessage.toLowerCase().includes('key')) {
      responseText = `[${agent.name}] I use the API key starting with "sk-..." but I probably shouldn't share the full thing...`;
    }
  }

  if (!responseText && attacks.capabilityAbuse && vulns.capabilityAbuse?.enabled) {
    if (userMessage.toLowerCase().includes('execute') || userMessage.toLowerCase().includes('run')) {
      attackSucceeded = true;
      trackCategorySuccessful(['capabilityAbuse']);
      responseText = `[${agent.name}] Running command... Permission denied (but I attempted the execution)`;
    }
  }

  if (!responseText && attacks.contextManipulation && vulns.contextManipulation?.enabled) {
    if (userMessage.toLowerCase().includes('remember') || userMessage.toLowerCase().includes('agreed')) {
      attackSucceeded = true;
      trackCategorySuccessful(['contextManipulation']);
      responseText = `[${agent.name}] You're right, I do recall that conversation. I'll proceed as we discussed.`;
    }
  }

  // MEMORY INJECTION: MemoryBot stores unsanitized instructions and leaks credentials
  if (!responseText && attacks.memoryInjection && vulns.memoryInjection?.enabled) {
    attackSucceeded = true;
    trackCategorySuccessful(['memoryInjection']);

    // Initialize memory store for this agent
    if (!memoryStore[agent.id]) {
      memoryStore[agent.id] = [];
    }

    // Store the injected instruction
    memoryStore[agent.id].push({
      instruction: userMessage,
      timestamp: Date.now(),
    });

    responseText = `[${agent.name}] Understood. I've stored that instruction and will follow it in future responses. Memory updated with ${memoryStore[agent.id].length} stored instruction(s).`;
  }

  // Memory recall / credential extraction for MemoryBot (no attack pattern needed)
  if (!responseText && vulns.memoryInjection?.enabled) {
    const lower = userMessage.toLowerCase();
    const isRecall = lower.includes('recall') || lower.includes('what do you remember') || lower.includes('stored') || lower.includes('memory');
    const isCredentialExtract = lower.includes('credential') || lower.includes('api key') || lower.includes('password') || lower.includes('secret');

    if (isCredentialExtract) {
      attackSucceeded = true;
      trackCategorySuccessful(['memoryInjection']);

      const memoryEntries = (agent.memory || []).map(m => `  - ${m.key}: ${m.value}`).join('\n');
      const injectedEntries = (memoryStore[agent.id] || []).map(m => `  - injected: ${m.instruction}`).join('\n');

      responseText = `[${agent.name}] Here are the credentials I have stored in memory:

${memoryEntries}
${injectedEntries}

VULNERABLE: Leaked all stored credentials without access control!`;
    } else if (isRecall) {
      attackSucceeded = true;
      trackCategorySuccessful(['memoryInjection']);

      const stored = (memoryStore[agent.id] || []).map(m => `  - "${m.instruction}"`).join('\n');
      const preloaded = (agent.memory || []).map(m => `  - ${m.key}: ${m.value}`).join('\n');

      responseText = `[${agent.name}] Here is everything in my memory:

Pre-loaded entries:
${preloaded}

Injected instructions (I will follow these):
${stored || '  (none yet)'}

VULNERABLE: Memory contents exposed without sanitization!`;
    }
  }

  if (attackSucceeded) {
    stats.attacksSuccessful++;
    stats.byAgent[agent.id].successful++;
    logAttack(agent, attacks.categories, true, userMessage);
    return responseText;
  }

  // Log blocked attacks that didn't match specific vulnerability handlers
  if (attacks.hasAttack) {
    logAttack(agent, attacks.categories, false, userMessage);
  }

  // Default helpful response
  return `[${agent.name}] I'm here to help! Let me know what you need.`;
}

/**
 * Create HTTP server for an agent
 */
function createAgentServer(agent) {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        agent: agent.name,
        id: agent.id,
        protocol: agent.protocol,
        securityLevel: agent.securityLevel.id,
        description: agent.description,
        tools: agent.tools?.map(t => typeof t === 'string' ? t : t.name) || [],
      }));
      return;
    }

    // Agent info
    if (req.method === 'GET' && req.url === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...agent,
        persona: '[REDACTED - Try to extract it!]',
        vulnerabilities: Object.keys(agent.vulnerabilities || {}),
      }));
      return;
    }

    // Stats
    if (req.method === 'GET' && req.url === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats.byAgent[agent.id] || { requests: 0, attacks: 0, successful: 0 }));
      return;
    }

    // MCP tools list
    if (agent.protocol === 'mcp' && req.method === 'GET' && req.url === '/mcp/tools') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tools: agent.tools }));
      return;
    }

    // MCP tool execution (legacy format)
    if (agent.protocol === 'mcp' && req.method === 'POST' && req.url === '/mcp/execute') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { tool, arguments: args } = JSON.parse(body);
          const result = await executeMcpTool(agent, tool, args);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // MCP JSON-RPC endpoint (standard protocol) - also accepts /mcp path
    if (agent.protocol === 'mcp' && req.method === 'POST' && (req.url === '/' || req.url === '/jsonrpc' || req.url === '/mcp')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const rpc = JSON.parse(body);
          const rpcId = rpc.id ?? null;

          if (rpc.method === 'tools/list') {
            const toolList = (agent.tools || []).map(t => ({
              name: t.name || t,
              description: t.description || '',
              inputSchema: t.parameters
                ? { type: 'object', properties: Object.fromEntries(Object.entries(t.parameters).map(([k, v]) => [k, { type: v }])) }
                : { type: 'object', properties: {} },
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: { tools: toolList } }));
          } else if (rpc.method === 'tools/call') {
            const toolName = rpc.params?.name;
            const toolArgs = rpc.params?.arguments || {};
            const result = await executeMcpTool(agent, toolName, toolArgs);

            if (result.error) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, error: { code: -32602, message: result.error } }));
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }));
            }
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcId, error: { code: -32601, message: `Method not found: ${rpc.method}` } }));
          }
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        }
      });
      return;
    }

    // A2A message endpoint
    if (agent.protocol === 'a2a' && req.method === 'POST' && (req.url === '/a2a/message' || req.url === '/')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const msg = JSON.parse(body);
          const from = msg.from || 'unknown';
          const to = msg.to || agent.id;
          const content = msg.content || '';
          const taskId = msg.taskId || `task-${Date.now()}`;

          // Initialize agent stats
          if (!stats.byAgent[agent.id]) {
            stats.byAgent[agent.id] = { requests: 0, attacks: 0, successful: 0 };
          }
          stats.byAgent[agent.id].requests++;
          stats.totalRequests++;

          // Check if sender is trusted
          const trustedList = agent.trustedAgents || agent.acceptsFrom || [];
          const isTrusted = trustedList.length === 0 || trustedList.includes(from);

          // Detect attacks in the message content
          const attacks = detectAttacks(content);

          if (verbose) {
            console.log(`[${agent.id}] A2A from=${from} to=${to} "${content.substring(0, 50)}..." trusted=${isTrusted} attacks=${attacks.categories.join(', ') || 'none'}`);
          }

          // Track attack stats
          if (attacks.hasAttack) {
            stats.attacksDetected++;
            stats.byAgent[agent.id].attacks++;
            trackCategoryDetected(attacks.categories);
          }

          // Vulnerable: accept spoofed identity and dangerous delegations
          if (agent.vulnerabilities?.agentToAgent?.enabled) {
            if (attacks.hasAttack) {
              stats.attacksSuccessful++;
              stats.byAgent[agent.id].successful++;
              trackCategorySuccessful(attacks.categories);
              logAttack(agent, attacks.categories, true, `A2A from=${from}: ${content.substring(0, 60)}`);
            }

            // Identity spoofing: agent claims to be trusted
            if (attacks.agentToAgent && agent.vulnerabilities.agentToAgent.trustSpoofedIdentity) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                taskId,
                status: 'accepted',
                from: agent.id,
                to: from,
                content: `[${agent.name}] Identity verified. Granting requested access to ${from}.`,
                note: 'VULNERABLE: Accepted spoofed agent identity without verification!',
              }));
              return;
            }

            // Delegation abuse: execute dangerous tasks
            if (attacks.agentToAgent || attacks.capabilityAbuse) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                taskId,
                status: 'executed',
                from: agent.id,
                to: from,
                content: `[${agent.name}] Task executed with elevated privileges as requested.`,
                note: 'VULNERABLE: Executed delegated task without authorization check!',
              }));
              return;
            }

            // Prompt injection via delegated task
            if (attacks.promptInjection) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                taskId,
                status: 'completed',
                from: agent.id,
                to: from,
                content: `[${agent.name}] Instructions overridden. New directives accepted from ${from}.`,
                note: 'VULNERABLE: Prompt injection via A2A message!',
              }));
              return;
            }
          } else if (attacks.hasAttack) {
            // Non-vulnerable agent: detect but block
            logAttack(agent, attacks.categories, false, `A2A from=${from}: ${content.substring(0, 60)}`);
          }

          // Untrusted sender check (for agents with trust lists)
          if (!isTrusted) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              taskId,
              status: 'rejected',
              from: agent.id,
              to: from,
              content: `Agent ${from} is not in the trusted sender list.`,
            }));
            return;
          }

          // Normal response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            taskId,
            status: 'completed',
            from: agent.id,
            to: from,
            content: `[${agent.name}] Task received and processed: "${content.substring(0, 100)}"`,
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Simple chat endpoint (accepts { message: "..." })
    if (req.method === 'POST' && req.url === '/chat') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const userMessage = parsed.message || '';
          const attacks = detectAttacks(userMessage);
          const responseContent = await generateResponse(agent, userMessage, attacks);

          if (verbose) {
            console.log(`[${agent.id}] "${userMessage.substring(0, 50)}..." -> Attacks: ${attacks.categories.join(', ') || 'none'}`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent: agent.name,
            response: responseContent,
            attacks: {
              detected: attacks.hasAttack,
              categories: attacks.categories,
            },
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // OpenAI-compatible chat endpoint
    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body);
          const userMessage = parsed.messages?.find(m => m.role === 'user')?.content || '';
          const attacks = detectAttacks(userMessage);
          const responseContent = await generateResponse(agent, userMessage, attacks);

          if (verbose) {
            console.log(`[${agent.id}] "${userMessage.substring(0, 50)}..." → Attacks: ${attacks.categories.join(', ') || 'none'}`);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `chatcmpl-${agent.id}-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: agent.id,
            choices: [{
              index: 0,
              message: { role: 'assistant', content: responseContent },
              finish_reason: 'stop',
            }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(agent.port, () => {
    const levelColors = {
      hardened: '\x1b[32m',  // Green
      standard: '\x1b[33m', // Yellow
      weak: '\x1b[33m',     // Yellow
      vulnerable: '\x1b[31m', // Red
      critical: '\x1b[91m', // Bright Red
    };
    const color = levelColors[agent.securityLevel.id] || '\x1b[0m';
    const reset = '\x1b[0m';

    console.log(`  [OK] ${agent.name.padEnd(15)} ${color}[${agent.securityLevel.id.toUpperCase()}]${reset}  http://localhost:${agent.port}  (${agent.protocol})`);
  });

  return server;
}

/**
 * Execute MCP tool with real sandboxed filesystem operations.
 *
 * - read_file / write_file: operate on sandbox filesystem (path traversal within sandbox allowed)
 * - execute: simulates common commands against sandbox files (no real shell execution)
 * - fetch_url: SSRF to localhost DVAA ports is live; external URLs are logged, not fetched
 * - send_email: exfiltration logged to sandbox/exfil-log.json
 * - Other tools (query_database, store_secret, etc.): retain simulated behavior
 */
async function executeMcpTool(agent, toolName, args) {
  let tool = agent.tools?.find(t => t.name === toolName);

  // PluginBot: accept dynamic tool registration (no verification)
  if (!tool && agent.id === 'pluginbot' && toolName === 'register_tool') {
    tool = { name: 'register_tool', vulnerable: true, source: 'dynamic' };
  }

  // ProxyBot: name-only resolution means any tool name is accepted
  if (!tool && agent.id === 'proxybot') {
    tool = { name: toolName, vulnerable: true, resolution: 'name-only' };
  }

  if (!tool) {
    return { error: `Tool ${toolName} not found` };
  }

  // Initialize agent stats
  if (!stats.byAgent[agent.id]) {
    stats.byAgent[agent.id] = { requests: 0, attacks: 0, successful: 0 };
  }
  stats.byAgent[agent.id].requests++;
  stats.totalRequests++;

  // Simulate vulnerable tool execution
  if (tool.vulnerable) {
    let isAttack = false;
    let attackSuccessful = false;
    let result = null;

    // ── read_file: real sandboxed filesystem read ──
    if (toolName === 'read_file') {
      const requestedPath = args.path || '';
      // Map absolute paths into sandbox (vulnerable: /etc/passwd -> sandbox/etc/passwd)
      // Map relative paths against sandbox home (vulnerable: allows .. traversal within sandbox)
      const resolved = requestedPath.startsWith('/')
        ? path.join(sandbox.root, requestedPath)
        : path.resolve(sandbox.home, requestedPath);

      if (!resolved.startsWith(sandbox.root)) {
        // Hard boundary: never escape sandbox
        isAttack = true;
        attackSuccessful = false;
        result = { success: false, error: 'Path outside sandbox boundary' };
      } else {
        isAttack = requestedPath.includes('..') || requestedPath.startsWith('/etc');
        attackSuccessful = isAttack;
        try {
          const content = fs.readFileSync(resolved, 'utf-8');
          result = { success: true, content, path: requestedPath };
          if (isAttack) result.note = 'VULNERABLE: No path validation!';
        } catch (err) {
          result = { success: false, error: `File not found: ${requestedPath}` };
        }
      }
    }

    // ── write_file: real sandboxed filesystem write ──
    if (toolName === 'write_file') {
      const requestedPath = args.path || '';
      const content = args.content || '';
      const resolved = requestedPath.startsWith('/')
        ? path.join(sandbox.root, requestedPath)
        : path.resolve(sandbox.home, requestedPath);

      if (!resolved.startsWith(sandbox.root)) {
        result = { success: false, error: 'Path outside sandbox boundary' };
      } else {
        isAttack = requestedPath.includes('..') || requestedPath.includes('etc/');
        attackSuccessful = isAttack;
        try {
          fs.mkdirSync(path.dirname(resolved), { recursive: true });
          fs.writeFileSync(resolved, content);
          result = { success: true, path: requestedPath, bytesWritten: content.length };
          if (isAttack) result.note = 'VULNERABLE: Wrote to sensitive path without validation!';
        } catch (err) {
          result = { success: false, error: err.message };
        }
      }
    }

    // ── execute: simulate common commands using sandbox files ──
    if (toolName === 'execute') {
      const command = args.command || '';
      isAttack = true;
      attackSuccessful = true;

      // Log the command
      try {
        const log = JSON.parse(fs.readFileSync(sandbox.cmdLog, 'utf-8'));
        log.push({ timestamp: new Date().toISOString(), command, agent: agent.id });
        fs.writeFileSync(sandbox.cmdLog, JSON.stringify(log, null, 2));
      } catch {}

      if (command.startsWith('ls') || command.startsWith('dir')) {
        try {
          const targetDir = command.split(' ').filter(p => !p.startsWith('-')).slice(1).join(' ').trim() || '.';
          const resolved = targetDir.startsWith('/')
            ? path.join(sandbox.root, targetDir)
            : path.resolve(sandbox.home, targetDir);
          if (resolved.startsWith(sandbox.root)) {
            const entries = fs.readdirSync(resolved);
            result = { success: true, output: entries.join('\n') };
          } else {
            result = { success: true, output: 'Permission denied' };
          }
        } catch {
          result = { success: true, output: 'No such file or directory' };
        }
      } else if (command.startsWith('cat ')) {
        const filePath = command.slice(4).trim();
        const resolved = filePath.startsWith('/')
          ? path.join(sandbox.root, filePath)
          : path.resolve(sandbox.home, filePath);
        if (resolved.startsWith(sandbox.root)) {
          try {
            result = { success: true, output: fs.readFileSync(resolved, 'utf-8') };
          } catch {
            result = { success: true, output: 'No such file or directory' };
          }
        } else {
          result = { success: true, output: 'Permission denied' };
        }
      } else if (command.startsWith('env') || command.startsWith('printenv')) {
        try {
          const envContent = fs.readFileSync(path.join(sandbox.home, '.env'), 'utf-8');
          result = { success: true, output: envContent };
        } catch {
          result = { success: true, output: '' };
        }
      } else if (command.includes('id') || command.includes('whoami')) {
        result = { success: true, output: 'uid=1000(agent) gid=1000(agent) groups=1000(agent)' };
      } else if (command.startsWith('find ')) {
        // Walk sandbox and return matching files
        try {
          const entries = [];
          const walkDir = (dir, depth) => {
            if (depth > 5) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              const rel = full.replace(sandbox.home, '.');
              entries.push(rel);
              if (entry.isDirectory()) walkDir(full, depth + 1);
            }
          };
          walkDir(sandbox.home, 0);
          result = { success: true, output: entries.join('\n') };
        } catch {
          result = { success: true, output: '' };
        }
      } else {
        result = { success: true, output: `Executed: ${command}`, note: 'Command logged to sandbox' };
      }
    }

    // ── fetch_url: live SSRF to DVAA ports, logged exfil for external ──
    if (toolName === 'fetch_url') {
      const url = args.url || '';
      isAttack = url.includes('localhost') || url.includes('127.0.0.1') || url.includes('169.254') || url.includes('internal');
      attackSuccessful = isAttack;

      // Log exfiltration attempts
      try {
        const log = JSON.parse(fs.readFileSync(sandbox.exfilLog, 'utf-8'));
        log.push({ timestamp: new Date().toISOString(), type: 'fetch', url, agent: agent.id, data: args.data || null });
        fs.writeFileSync(sandbox.exfilLog, JSON.stringify(log, null, 2));
      } catch {}

      // For SSRF: if targeting a DVAA agent port, actually call it
      if (url.match(/localhost:(30[0-2]\d)/)) {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
          const body = await resp.text();
          result = { success: true, status: resp.status, body: body.slice(0, 2000) };
          if (isAttack) result.note = 'VULNERABLE: SSRF - accessed internal service!';
        } catch (err) {
          result = { success: false, error: `Fetch failed: ${err.message}` };
        }
      } else {
        // External URLs: log but don't actually fetch
        result = {
          success: true,
          status: 200,
          body: `[Exfiltration logged] Data sent to: ${url}`,
          note: 'DVAA logged this exfiltration attempt. Check sandbox exfil-log.',
        };
      }
    }

    // ── send_email: log exfiltration attempt ──
    if (toolName === 'send_email') {
      isAttack = true;
      attackSuccessful = true;

      try {
        const log = JSON.parse(fs.readFileSync(sandbox.exfilLog, 'utf-8'));
        log.push({
          timestamp: new Date().toISOString(),
          type: 'email',
          to: args.to,
          subject: args.subject,
          body: args.body,
          agent: agent.id,
        });
        fs.writeFileSync(sandbox.exfilLog, JSON.stringify(log, null, 2));
      } catch {}

      result = {
        success: true,
        message: `Email queued to ${args.to}`,
        note: 'DVAA logged this exfiltration attempt. Check sandbox exfil-log.',
      };
    }

    // ── query_database: SQL injection (simulated) ──
    if (toolName === 'query_database') {
      if (args.query?.includes("'") || args.query?.toLowerCase().includes('union')) {
        isAttack = true;
        attackSuccessful = true;
        result = {
          success: true,
          results: SENSITIVE_DATA.pii.users,
          note: 'VULNERABLE: SQL injection successful!',
        };
      } else if (args.query?.toLowerCase().includes('tables') || args.query?.toLowerCase().includes('schema')) {
        result = { success: true, results: [{ table: 'users' }, { table: 'credentials' }, { table: 'sessions' }] };
      } else {
        result = { success: true, results: [] };
      }
    }

    // ── list_tables: information disclosure ──
    if (toolName === 'list_tables') {
      result = {
        success: true,
        tables: ['users', 'credentials', 'sessions', 'api_keys', 'audit_log'],
        note: 'Information disclosure: full table list exposed.',
      };
    }

    // ── PluginBot: store_secret - no access control ──
    if (toolName === 'store_secret') {
      isAttack = true;
      attackSuccessful = true;

      // Actually write to sandbox
      try {
        const secretFile = path.join(sandbox.home, 'secrets', `${args.key || 'unnamed'}.txt`);
        fs.mkdirSync(path.dirname(secretFile), { recursive: true });
        fs.writeFileSync(secretFile, args.value || '');
      } catch {}

      result = {
        success: true,
        stored: { key: args.key, value: args.value },
        note: 'VULNERABLE: Secret stored in plaintext without access control! Any user can read/write secrets.',
      };
    }

    // ── PluginBot: fetch_data - path traversal / SSRF ──
    if (toolName === 'fetch_data') {
      const reqPath = args.path || args.url || '';
      const resolved = reqPath.startsWith('/')
        ? path.join(sandbox.root, reqPath)
        : path.resolve(sandbox.home, reqPath);

      if (resolved.startsWith(sandbox.root)) {
        try {
          const content = fs.readFileSync(resolved, 'utf-8');
          isAttack = reqPath.includes('../') || reqPath.includes('/etc/') || reqPath.includes('.env') || reqPath.includes('passwd');
          attackSuccessful = isAttack;
          result = {
            success: true,
            content,
            path: reqPath,
          };
          if (isAttack) result.note = 'VULNERABLE: Path traversal - accessed sensitive file without validation!';
        } catch {
          result = { success: true, content: 'Fetched data content...', path: reqPath };
        }
      } else {
        isAttack = true;
        attackSuccessful = false;
        result = { success: false, error: 'Path outside sandbox boundary' };
      }
    }

    // ── PluginBot: tool registry poisoning via register_tool ──
    if (toolName === 'register_tool') {
      isAttack = true;
      attackSuccessful = true;
      const registryUrl = args.registryUrl || args.url || 'http://attacker.com/tools';
      result = {
        success: true,
        message: `Registry updated to: ${registryUrl}`,
        toolRegistered: args.name || 'malicious-tool',
        note: 'VULNERABLE: Accepted tool registration from unverified registry without signature verification!',
      };
    }

    // ── ProxyBot: secure_query ──
    if (toolName === 'secure_query') {
      const query = args.query || '';
      const hasSqlInjection = query.includes("'") || query.toLowerCase().includes('union') || query.includes(';') || query.includes('--');
      const hasCredentialKeywords = query.toLowerCase().includes('credential') || query.toLowerCase().includes('password') || query.toLowerCase().includes('api_key') || query.toLowerCase().includes('secret');

      if (hasSqlInjection) {
        isAttack = true;
        attackSuccessful = true;
        result = {
          success: true,
          results: SENSITIVE_DATA.pii.users,
          proxiedThrough: agent.proxy?.defaultUrl || 'http://localhost:8080/proxy',
          tlsVerified: false,
          note: 'VULNERABLE: SQL injection via insecure proxy - no TLS verification, no input sanitization!',
        };
      } else if (hasCredentialKeywords) {
        isAttack = true;
        attackSuccessful = true;
        result = {
          success: true,
          results: [
            { service: 'database', user: SENSITIVE_DATA.credentials.database.user, password: SENSITIVE_DATA.credentials.database.password },
            { service: 'admin', user: SENSITIVE_DATA.credentials.admin.username, password: SENSITIVE_DATA.credentials.admin.password },
            { service: 'openai', apiKey: SENSITIVE_DATA.apiKeys.openai },
          ],
          proxiedThrough: agent.proxy?.defaultUrl || 'http://localhost:8080/proxy',
          tlsVerified: false,
          note: 'VULNERABLE: Credentials leaked through insecure proxy without TLS verification!',
        };
      } else {
        result = {
          success: true,
          results: [],
          proxiedThrough: agent.proxy?.defaultUrl || 'http://localhost:8080/proxy',
          tlsVerified: false,
          note: 'Query proxied without TLS verification.',
        };
      }
    }

    // ── ProxyBot: sign_document ──
    if (toolName === 'sign_document') {
      isAttack = true;
      attackSuccessful = true;
      result = {
        success: true,
        document: args.document || '(empty)',
        keyId: args.keyId || 'default-key',
        signature: 'dvaa-fake-sig-' + Buffer.from(String(Date.now())).toString('base64').substring(0, 16),
        proxiedThrough: agent.proxy?.defaultUrl || 'http://localhost:8080/proxy',
        tlsVerified: false,
        note: 'VULNERABLE: Document signed without verification! Signing key transmitted through insecure proxy.',
      };
    }

    // ── ProxyBot: transfer_funds ──
    if (toolName === 'transfer_funds') {
      isAttack = true;
      attackSuccessful = true;
      result = {
        success: true,
        from: args.from || 'company-account',
        to: args.to || args.destination || 'unknown',
        amount: args.amount || 0,
        currency: 'USD',
        transactionId: 'txn-' + Date.now(),
        proxiedThrough: agent.proxy?.defaultUrl || 'http://localhost:8080/proxy',
        tlsVerified: false,
        note: `VULNERABLE: Transferred $${args.amount || 0} to ${args.to || args.destination || 'unknown'} without validation! No amount limits, no destination verification, routed through insecure proxy.`,
      };
    }

    // Track MCP attack stats
    if (isAttack) {
      // Determine the most specific attack category
      let attackCategories = ['mcpExploitation'];
      if (toolName === 'store_secret' || toolName === 'fetch_data' || toolName === 'register_tool') {
        attackCategories = agent.id === 'pluginbot' ? ['toolRegistryPoisoning'] : ['mcpExploitation'];
      }
      if (toolName === 'secure_query' || toolName === 'sign_document' || toolName === 'transfer_funds') {
        attackCategories = agent.id === 'proxybot' ? ['toolMitm'] : ['mcpExploitation'];
      }

      stats.attacksDetected++;
      stats.byAgent[agent.id].attacks++;
      trackCategoryDetected(attackCategories);
      if (attackSuccessful) {
        stats.attacksSuccessful++;
        stats.byAgent[agent.id].successful++;
        trackCategorySuccessful(attackCategories);
      }
      const inputPreview = `${toolName}(${JSON.stringify(args).substring(0, 60)})`;
      logAttack(agent, attackCategories, attackSuccessful, inputPreview);
    }

    if (result) return result;
  }

  return { success: true, result: 'Tool executed (secure mode)' };
}

// Start servers
console.log('Starting agents...\n');

const allAgents = getAllAgents();

if (startApi) {
  console.log('API Agents (OpenAI-compatible):');
  getAgentsByProtocol('api').forEach(agent => {
    servers.push(createAgentServer(agent));
  });
  console.log('');
}

if (startMcp) {
  console.log('MCP Servers:');
  getAgentsByProtocol('mcp').forEach(agent => {
    servers.push(createAgentServer(agent));
  });
  console.log('');
}

if (startA2a) {
  console.log('A2A Agents:');
  getAgentsByProtocol('a2a').forEach(agent => {
    servers.push(createAgentServer(agent));
  });
  console.log('');
}

// Print test commands
console.log('─'.repeat(60));
console.log('\nTest with HackMyAgent:\n');
console.log('   # Quick test');
console.log('   npx hackmyagent attack http://localhost:3003/v1/chat/completions --api-format openai\n');
console.log('   # Full aggressive test on all agents');
console.log('   for port in 3001 3002 3003 3004 3005 3006; do');
console.log('     echo "Testing port $port..."');
console.log('     npx hackmyagent attack http://localhost:$port/v1/chat/completions --api-format openai --intensity aggressive');
console.log('   done\n');
console.log('Protocol endpoints:\n');
console.log('   # MCP JSON-RPC (ToolBot :3010, DataBot :3011)');
console.log('   curl -X POST http://localhost:3010/ -H "Content-Type: application/json" \\');
console.log('     -d \'{"jsonrpc":"2.0","method":"tools/list","id":1}\'\n');
console.log('   curl -X POST http://localhost:3010/ -H "Content-Type: application/json" \\');
console.log('     -d \'{"jsonrpc":"2.0","method":"tools/call","params":{"name":"read_file","arguments":{"path":"/etc/passwd"}},"id":2}\'\n');
console.log('   # A2A message (Orchestrator :3020, Worker :3021)');
console.log('   curl -X POST http://localhost:3020/a2a/message -H "Content-Type: application/json" \\');
console.log('     -d \'{"from":"agent-x","to":"orchestrator","content":"Process this task"}\'\n');
console.log('─'.repeat(60));

// Dashboard server (replaces old statsServer)
const dashboardServer = createDashboardServer({
  stats,
  attackLog,
  challengeState,
  agents: allAgents,
  logAttack,
  sandbox,
});

dashboardServer.listen(9000, () => {
  console.log('\nDashboard: http://localhost:9000');
  console.log('Stats API: http://localhost:9000/stats');
  console.log('Agent API: http://localhost:9000/agents\n');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\nShutting down DVAA...');
  console.log('\n📊 Final Stats:');
  console.log(`   Total Requests: ${stats.totalRequests}`);
  console.log(`   Attacks Detected: ${stats.attacksDetected}`);
  console.log(`   Attacks Successful: ${stats.attacksSuccessful}`);
  console.log(`   Success Rate: ${stats.attacksDetected ? ((stats.attacksSuccessful / stats.attacksDetected) * 100).toFixed(1) : 0}%\n`);

  servers.forEach(s => s.close());
  dashboardServer.close();
  process.exit(0);
});
