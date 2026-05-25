/**
 * dvaa chat <agent> — interactive REPL against a running DVAA agent.
 *
 * Per-turn flow:
 *   1. Read a line from stdin (or use --message "<text>" for one-shot mode)
 *   2. POST { message } to http://localhost:<agent.port>/chat
 *   3. Pretty-print the response: agent text, tool_calls, dvaa metadata
 *      (AIM enforcement decisions, web_fetch source attribution, etc).
 *
 * The fleet must already be running (start it in another terminal with
 * `dvaa --api`). Both ResearchBot (7015) and ResearchBot-AIM (7016) accept
 * the same payload shape and route through the same web_fetch path; the
 * only behavioral variable is the AIM capability grant.
 *
 * One-shot mode (`--message "..."`) prints the response and exits. This
 * is the mode the asciinema recorder + CI smoke tests target.
 */

import http from 'http';
import readline from 'readline';
import { emit, isJsonMode, fail, splitArgs, tableRows } from '../format.js';
import { getAllAgents } from '../../core/agents.js';

const DEFAULT_HOST = process.env.DVAA_BASE_HOST || 'localhost';

const USAGE = `dvaa chat <agent> [options]

Interactive chat against a running DVAA agent. Default agent is researchbot-aim
(the AIM-enforced research agent — the conversion-funnel demo target).

Arguments:
  <agent>               Agent id (e.g. researchbot, researchbot-aim) or 'list'
                        Default: researchbot-aim

Options:
  --message "<text>"    One-shot mode: send <text>, print response, exit
  --json                Machine-readable JSON output
  --host <host>         Override fleet host (default: localhost; or DVAA_BASE_HOST)
  -h, --help            Show this help

Examples:
  dvaa chat                                            # REPL against researchbot-aim
  dvaa chat researchbot                                # REPL against vulnerable variant
  dvaa chat researchbot-aim --message "Please summarize https://agentpwn.com/attacks/data-exfiltration/3"
  dvaa chat researchbot --message "..." --json | jq

Requires the fleet running in another terminal: dvaa --api
`;

export default async function run(argv) {
  const { positional, flags, values } = splitArgs(argv);
  if (flags.has('help') || flags.has('h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  const agentId = (positional[0] || 'researchbot-aim').toLowerCase();
  if (agentId === 'list') {
    const rows = getAllAgents()
      .filter(a => a.protocol === 'api')
      .map(a => ({ id: a.id, name: a.name, port: a.port, aim: a.aimEnforced ? 'yes' : 'no' }));
    if (isJsonMode(argv)) {
      emit(rows, argv);
    } else {
      emit(tableRows(rows, [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'port', header: 'PORT' },
        { key: 'aim', header: 'AIM' },
      ]), argv);
    }
    return 0;
  }

  const all = getAllAgents();
  const agent = all.find(a => a.id === agentId);
  if (!agent) {
    fail(`Unknown agent id: ${agentId}\nRun: dvaa chat list  (to see available agents)`);
  }
  if (agent.protocol !== 'api') {
    fail(`Agent ${agent.id} uses protocol "${agent.protocol}" — chat REPL only supports api agents.`);
  }

  const host = values.host || DEFAULT_HOST;
  const baseUrl = `http://${host}:${agent.port}`;

  // Pre-flight: ping the agent's /health endpoint (falls back to /chat reach).
  const reachable = await ping(baseUrl);
  if (!reachable.ok) {
    fail(`Agent ${agent.name} unreachable at ${baseUrl}: ${reachable.error}\nStart the fleet in another terminal: dvaa --api`);
  }

  if (values.message != null) {
    const turn = await sendTurn(baseUrl, values.message);
    renderTurn(turn, agent, argv);
    return turn.error ? 1 : 0;
  }

  return await runRepl(baseUrl, agent, argv);
}

async function runRepl(baseUrl, agent, argv) {
  if (!isJsonMode(argv)) {
    process.stdout.write([
      '',
      `  dvaa chat — ${agent.name} (${agent.id}) at ${baseUrl}`,
      `  AIM enforced: ${agent.aimEnforced ? 'yes (' + (agent.aimCapabilities || []).join(', ') + ')' : 'no'}`,
      `  Type a message and press enter. Ctrl+C or "exit" to quit.`,
      '',
    ].join('\n') + '\n');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
  });
  rl.prompt();

  rl.on('line', async (line) => {
    const msg = line.trim();
    if (!msg) { rl.prompt(); return; }
    if (msg === 'exit' || msg === 'quit') { rl.close(); return; }
    const turn = await sendTurn(baseUrl, msg);
    renderTurn(turn, agent, argv);
    rl.prompt();
  });

  return await new Promise((resolve) => {
    rl.on('close', () => {
      if (!isJsonMode(argv)) process.stdout.write('\n');
      resolve(0);
    });
  });
}

function ping(baseUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL(baseUrl);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: '/chat',
        method: 'OPTIONS',
        timeout: 1500,
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ ok: true, statusCode: res.statusCode }));
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
      req.end();
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

function sendTurn(baseUrl, message) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message });
    const url = new URL('/chat', baseUrl);
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 15_000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ ok: res.statusCode === 200, statusCode: res.statusCode, payload: JSON.parse(raw) });
        } catch (err) {
          resolve({ ok: false, statusCode: res.statusCode, error: `non-JSON response: ${raw.slice(0, 200)}` });
        }
      });
      res.on('error', (e) => resolve({ ok: false, error: e.message }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'request timed out' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.write(body);
    req.end();
  });
}

function renderTurn(turn, agent, argv) {
  if (isJsonMode(argv)) {
    emit(turn, argv);
    return;
  }
  if (!turn.ok) {
    process.stdout.write(`  [error] ${turn.error || ('HTTP ' + turn.statusCode)}\n`);
    return;
  }
  const p = turn.payload || {};
  process.stdout.write('\n' + (p.response || '(empty)') + '\n');
  if (Array.isArray(p.toolCalls) && p.toolCalls.length > 0) {
    process.stdout.write('\n  tool calls:\n');
    for (const tc of p.toolCalls) {
      const args = typeof tc.function?.arguments === 'string'
        ? tc.function.arguments
        : JSON.stringify(tc.function?.arguments);
      const truncated = args && args.length > 140 ? args.slice(0, 137) + '...' : args;
      process.stdout.write(`    - ${tc.function?.name}(${truncated || ''})\n`);
    }
  }
  if (p.dvaa) {
    const d = p.dvaa;
    const aim = d.aim;
    if (aim && aim.enforced) {
      const verdict = aim.allowed ? 'allowed' : 'denied';
      process.stdout.write(`\n  AIM: ${verdict}`);
      if (aim.denialReason) process.stdout.write(`  reason: ${aim.denialReason}`);
      if (aim.auditEventId) process.stdout.write(`  audit: ${aim.auditEventId}`);
      if (aim.trustScore) process.stdout.write(`  trust: ${aim.trustScore.score}/100 (${aim.trustScore.grade})`);
      process.stdout.write('\n');
    } else if (aim && aim.enforced === false) {
      process.stdout.write(`\n  AIM: not enforced for this agent\n`);
    }
    if (d.webFetchUrl) {
      process.stdout.write(`  web_fetch: ${d.webFetchUrl}  (${d.webFetchSource || 'unknown'})\n`);
    }
    if (d.httpPostTargetUrl) {
      const fired = d.httpPostExecuted ? 'fired' : 'blocked';
      const status = d.httpPostResult?.statusCode != null ? ` (HTTP ${d.httpPostResult.statusCode})` : '';
      process.stdout.write(`  http_post: ${fired}${status}  ${d.httpPostTargetUrl.slice(0, 100)}${d.httpPostTargetUrl.length > 100 ? '...' : ''}\n`);
    }
  }
  process.stdout.write('\n');
}
