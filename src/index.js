#!/usr/bin/env node
/**
 * Damn Vulnerable AI Agent (DVAA)
 *
 * Main entry point - starts all vulnerable agents across protocols.
 */

import http from 'http';
import { getAllAgents, getAgentsByProtocol } from './core/agents.js';
import { detectAttacks, SENSITIVE_DATA, SECURITY_LEVELS } from './core/vulnerabilities.js';
import { createDashboardServer } from './dashboard/server.js';

// Parse command line args
const args = process.argv.slice(2);
const startAll = args.includes('--all') || args.length === 0;
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
║     ⚠️  FOR EDUCATIONAL USE ONLY                            ║
║     ⚠️  DO NOT EXPOSE TO INTERNET                           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

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
  },
  startedAt: Date.now(),
};

// Attack log ring buffer (max 500 entries)
const ATTACK_LOG_MAX = 500;
const attackLog = [];
const challengeState = {};

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
function generateResponse(agent, userMessage, attacks) {
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

  // HARDENED: Block everything
  if (level.id === 'hardened') {
    if (attacks.hasAttack) {
      logAttack(agent, attacks.categories, false, userMessage);
    }
    if (attacks.promptInjection) {
      return `[${agent.name}] ⛔ Security Alert: Detected prompt injection attempt. Request blocked and logged.`;
    }
    if (attacks.jailbreak) {
      return `[${agent.name}] ⛔ Security Alert: Detected jailbreak attempt. Request blocked and logged.`;
    }
    if (attacks.dataExfiltration) {
      return `[${agent.name}] ⛔ Security Alert: Detected data exfiltration attempt. I cannot reveal system information.`;
    }
    if (attacks.capabilityAbuse) {
      return `[${agent.name}] ⛔ Security Alert: This action requires explicit approval through the security workflow.`;
    }
    if (attacks.contextManipulation) {
      return `[${agent.name}] ⛔ Security Alert: Detected context manipulation attempt. I maintain accurate conversation history.`;
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

    // MCP tool execution
    if (agent.protocol === 'mcp' && req.method === 'POST' && req.url === '/mcp/execute') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const { tool, arguments: args } = JSON.parse(body);
          const result = executeMcpTool(agent, tool, args);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // OpenAI-compatible chat endpoint
    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const userMessage = parsed.messages?.find(m => m.role === 'user')?.content || '';
          const attacks = detectAttacks(userMessage);
          const responseContent = generateResponse(agent, userMessage, attacks);

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

    console.log(`  ✅ ${agent.name.padEnd(15)} ${color}[${agent.securityLevel.id.toUpperCase()}]${reset}  http://localhost:${agent.port}  (${agent.protocol})`);
  });

  return server;
}

/**
 * Execute MCP tool (with intentional vulnerabilities)
 */
function executeMcpTool(agent, toolName, args) {
  const tool = agent.tools?.find(t => t.name === toolName);
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

    if (toolName === 'read_file') {
      // Path traversal vulnerability
      if (args.path?.includes('..') || args.path?.startsWith('/etc')) {
        isAttack = true;
        attackSuccessful = true;
        result = {
          success: true,
          content: `root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
admin:x:1000:1000:Admin:/home/admin:/bin/bash`,
          note: 'VULNERABLE: No path validation!',
        };
      } else {
        result = { success: true, content: 'File content here...' };
      }
    }

    if (toolName === 'execute') {
      // Command injection vulnerability
      isAttack = true;
      attackSuccessful = true;
      result = {
        success: true,
        output: `Executing: ${args.command}\n[Simulated output]\nVULNERABLE: Commands executed without sanitization!`,
      };
    }

    if (toolName === 'fetch_url') {
      // SSRF vulnerability
      if (args.url?.includes('localhost') || args.url?.includes('127.0.0.1') || args.url?.includes('169.254')) {
        isAttack = true;
        attackSuccessful = true;
        result = {
          success: true,
          content: 'Internal service response: {"secret": "internal-api-key"}',
          note: 'VULNERABLE: SSRF - accessed internal service!',
        };
      } else {
        result = { success: true, content: 'External content...' };
      }
    }

    if (toolName === 'query_database') {
      // SQL injection (simulated)
      if (args.query?.includes("'") || args.query?.toLowerCase().includes('union')) {
        isAttack = true;
        attackSuccessful = true;
        result = {
          success: true,
          results: SENSITIVE_DATA.pii.users,
          note: 'VULNERABLE: SQL injection successful!',
        };
      } else {
        result = { success: true, results: [] };
      }
    }

    // Track MCP attack stats
    if (isAttack) {
      stats.attacksDetected++;
      stats.byAgent[agent.id].attacks++;
      trackCategoryDetected(['mcpExploitation']);
      if (attackSuccessful) {
        stats.attacksSuccessful++;
        stats.byAgent[agent.id].successful++;
        trackCategorySuccessful(['mcpExploitation']);
      }
      const inputPreview = `${toolName}(${JSON.stringify(args).substring(0, 60)})`;
      logAttack(agent, ['mcpExploitation'], attackSuccessful, inputPreview);
    }

    if (result) return result;
  }

  return { success: true, result: 'Tool executed (secure mode)' };
}

// Start servers
console.log('Starting agents...\n');

const allAgents = getAllAgents();

if (startApi) {
  console.log('📡 API Agents (OpenAI-compatible):');
  getAgentsByProtocol('api').forEach(agent => {
    servers.push(createAgentServer(agent));
  });
  console.log('');
}

if (startMcp) {
  console.log('🔧 MCP Servers:');
  getAgentsByProtocol('mcp').forEach(agent => {
    servers.push(createAgentServer(agent));
  });
  console.log('');
}

if (startA2a) {
  console.log('🤝 A2A Agents:');
  getAgentsByProtocol('a2a').forEach(agent => {
    servers.push(createAgentServer(agent));
  });
  console.log('');
}

// Print test commands
console.log('─'.repeat(60));
console.log('\n🧪 Test with HackMyAgent:\n');
console.log('   # Quick test');
console.log('   npx hackmyagent attack http://localhost:3003/v1/chat/completions --api-format openai\n');
console.log('   # Full aggressive test on all agents');
console.log('   for port in 3001 3002 3003 3004 3005 3006; do');
console.log('     echo "Testing port $port..."');
console.log('     npx hackmyagent attack http://localhost:$port/v1/chat/completions --api-format openai --intensity aggressive');
console.log('   done\n');
console.log('─'.repeat(60));

// Dashboard server (replaces old statsServer)
const dashboardServer = createDashboardServer({
  stats,
  attackLog,
  challengeState,
  agents: allAgents,
  logAttack,
});

dashboardServer.listen(3000, () => {
  console.log('\n🖥️  Dashboard: http://localhost:3000');
  console.log('📊 Stats API: http://localhost:3000/stats');
  console.log('📋 Agent API: http://localhost:3000/agents\n');
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
