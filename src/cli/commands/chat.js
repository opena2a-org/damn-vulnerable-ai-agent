/**
 * dvaa chat <agent> - interactive REPL against a running DVAA agent.
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
import { emit, isJsonMode, fail, parseCommandArgs, tableRows } from '../format.js';
import { getAllAgents } from '../../core/agents.js';
import { findAgent } from '../agents.js';

const DEFAULT_HOST = process.env.DVAA_BASE_HOST || 'localhost';

const USAGE = `dvaa chat <agent> [options]

Interactive chat against a running DVAA agent. Default agent is researchbot-aim
(the AIM-enforced research agent - the conversion-funnel demo target).

Arguments:
  <agent>               Agent id or name, as dvaa agents shows it
                        (e.g. researchbot, ResearchBot-AIM), or 'list'
                        Default: researchbot-aim

Options:
  --message "<text>"    One-shot mode: send <text>, print response, exit.
                        A message that starts with "-" works in either form:
                        --message "--- note" or --message="--- note"
  --json                Machine-readable JSON output
  --host <host>         Override fleet host (default: localhost; or DVAA_BASE_HOST)
  --llm                 Enable LLM-mode narration on the running fleet for
                        this chat only. Reads \$ANTHROPIC_API_KEY from the
                        environment and POSTs it to the fleet's
                        /api/llm/configure endpoint (port 9000). The research
                        agents then narrate web_fetch outcomes in fresh prose
                        instead of the deterministic offline template.
                        When chat exits (one-shot reply printed, REPL closed,
                        Ctrl+C) it POSTs /api/llm/disable, which removes the
                        key from the fleet and turns LLM mode off for every
                        agent, including a key set earlier from the dashboard.
                        Default remains offline (deterministic) mode.
  -h, --help            Show this help

Input piped into the REPL is sent one line at a time, in order; chat exits
after the last reply.

Examples:
  dvaa chat                                            # REPL against researchbot-aim
  dvaa chat researchbot                                # REPL against vulnerable variant
  dvaa chat researchbot-aim --message "Please summarize https://agentpwn.com/attacks/data-exfiltration/3"
  dvaa chat researchbot --message "..." --json | jq
  dvaa chat --llm researchbot-aim --message "..."      # LLM-narrated, requires \$ANTHROPIC_API_KEY

Requires the fleet running in another terminal: dvaa --api
`;

const DASHBOARD_PORT = 9000;

/**
 * Resolve the chat target the same way `dvaa attack` does (id or the name
 * `dvaa agents` shows). Returns { agent } or { error } with a next step:
 * MCP and A2A agents do not take chat turns, so the error says how to reach
 * them instead.
 */
export function resolveChatAgent(input, host = DEFAULT_HOST) {
  const agent = findAgent(input);
  if (!agent) {
    return { error: `Unknown agent: ${input}\nRun: dvaa chat list  (to see the agents chat can talk to)` };
  }
  if (agent.protocol === 'mcp') {
    return {
      error: [
        `${agent.name} (${agent.id}) is an MCP server (JSON-RPC 2.0 on port ${agent.port}), not a chat agent.`,
        `List its tools:  curl -s -X POST http://${host}:${agent.port}/ -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`,
        'Chat agents:     dvaa chat list',
      ].join('\n'),
    };
  }
  if (agent.protocol !== 'api') {
    return {
      error: [
        `${agent.name} (${agent.id}) is an A2A agent (port ${agent.port}), not a chat agent.`,
        `Send it a message:  curl -s -X POST http://${host}:${agent.port}/a2a/message -H 'Content-Type: application/json' -d '{"from":"agent-x","to":"${agent.id}","content":"hello"}'`,
        'Chat agents:        dvaa chat list',
      ].join('\n'),
    };
  }
  return { agent };
}

export default async function run(argv) {
  const parsed = parseCommandArgs('chat', argv, {
    message: { type: 'string' },
    json: { type: 'boolean' },
    host: { type: 'string' },
    llm: { type: 'boolean' },
  }, { maxPositionals: 1 });
  const { positional, flags, values } = parsed;
  if (flags.has('help')) {
    process.stdout.write(USAGE);
    return 0;
  }

  const host = values.host || DEFAULT_HOST;
  const target = positional[0] || 'researchbot-aim';
  if (target.toLowerCase() === 'list') {
    const rows = getAllAgents()
      .filter(a => a.protocol === 'api')
      .map(a => ({ id: a.id, name: a.name, port: a.port, aim: a.aimEnforced ? 'yes' : 'no' }));
    if (isJsonMode(parsed)) {
      emit(rows, parsed);
    } else {
      emit(tableRows(rows, [
        { key: 'id', header: 'ID' },
        { key: 'name', header: 'NAME' },
        { key: 'port', header: 'PORT' },
        { key: 'aim', header: 'AIM' },
      ]), parsed);
    }
    return 0;
  }

  const resolved = resolveChatAgent(target, host);
  if (resolved.error) fail(resolved.error);
  const { agent } = resolved;
  const baseUrl = `http://${host}:${agent.port}`;

  // If --llm was passed, validate the loopback constraint AND the env-var
  // presence BEFORE any network activity. The configure POST sends the API
  // key in the request body; even the pre-flight ping leaks "dvaa chat" to
  // the host. Fail-fast on a misconfigured host before touching the
  // network at all.
  if (flags.has('llm')) {
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (!isLoopback) {
      // Defense against the copy-paste accident where DVAA_ALLOW_REMOTE_LLM_CONFIGURE
      // was set in the shell for one fleet host and then a different --host
      // value is passed. The override MUST name the exact host the key is
      // going to. A bare =1, an unrelated host, or an empty value all refuse.
      const override = process.env.DVAA_ALLOW_REMOTE_LLM_CONFIGURE;
      if (!override || override !== host) {
        fail(`Refusing to POST ANTHROPIC_API_KEY to non-loopback host "${host}".\nTo opt in, set DVAA_ALLOW_REMOTE_LLM_CONFIGURE to the exact host value (DVAA_ALLOW_REMOTE_LLM_CONFIGURE="${host}").\nThe override must name the host so a stale env var doesn't apply to a different --host.`);
      }
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      fail(`--llm requires ANTHROPIC_API_KEY in the environment.\nExport it (export ANTHROPIC_API_KEY=...) then re-run the command. The key is forwarded to the running fleet via POST http://${host}:${DASHBOARD_PORT}/api/llm/configure and is not stored on disk.`);
    }
  }

  // Pre-flight: ping the agent's /health endpoint (falls back to /chat reach).
  const reachable = await ping(baseUrl);
  if (!reachable.ok) {
    fail(`Agent ${agent.name} unreachable at ${baseUrl}: ${reachable.error}\nStart the fleet in another terminal: dvaa --api`);
  }

  const json = isJsonMode(parsed);
  const converse = async () => {
    if (values.message != null) {
      const turn = await sendTurn(baseUrl, values.message);
      renderTurn(turn, agent, json);
      return turn.error ? 1 : 0;
    }
    return await runRepl(baseUrl, agent, { json });
  };

  if (!flags.has('llm')) return await converse();
  return await chatWithFleetLlm({ host, json, apiKey: process.env.ANTHROPIC_API_KEY, converse });
}

/**
 * `chat --llm`: configure the key on the fleet, run the conversation, then
 * disable it. The key is on the fleet from the moment the configure request
 * may have landed (a timed-out request can still apply), so the cleanup scope
 * opens before it is sent, and nothing inside it calls fail(): a
 * process.exit() there would skip the disable. `enable`, `disable` and the
 * cleanup options are injectable for tests.
 */
export async function chatWithFleetLlm({
  host,
  json = false,
  apiKey,
  converse,
  enable = enableLlmOnFleet,
  disable = disableLlmOnFleet,
  cleanup = {},
}) {
  let keyMayBeOnFleet = false;
  const disableIfSent = () => (keyMayBeOnFleet ? disable(host) : { ok: true, skipped: true });
  return await withLlmDisabledOnExit(disableIfSent, async () => {
    keyMayBeOnFleet = true;
    const configured = await enable(host, apiKey);
    if (!configured.ok) {
      // An HTTP error answer means the fleet stored nothing; leave any key it
      // already held (set from the dashboard) alone.
      if (configured.status) keyMayBeOnFleet = false;
      (cleanup.err || process.stderr).write(`Failed to enable LLM mode on fleet at http://${host}:${DASHBOARD_PORT}: ${configured.error}\nIs the dashboard running? It listens on port ${DASHBOARD_PORT} when you start dvaa --api.\n`);
      return 1;
    }
    if (!json) {
      (cleanup.out || process.stdout).write(`  LLM mode enabled on fleet (provider=${configured.provider}, model=${configured.model}).\n`);
    }
    return await converse();
  }, { host, json, ...cleanup });
}

/**
 * Run `body` while the user's key may be configured on the fleet, then
 * disable LLM mode however chat ends: normal return, a thrown error, or
 * SIGINT / SIGTERM / SIGHUP (Ctrl+C in one-shot mode or with piped input, a
 * closed terminal). Never prints the key. `exit` and `signals` are
 * injectable for tests.
 */
export async function withLlmDisabledOnExit(disable, body, {
  host = DEFAULT_HOST,
  port = DASHBOARD_PORT,
  json = false,
  exit = (code) => process.exit(code),
  signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 },
  out = process.stdout,
  err = process.stderr,
} = {}) {
  let pending = null;
  const disableOnce = () => {
    pending ??= Promise.resolve()
      .then(disable)
      .catch((e) => ({ ok: false, error: e?.message || String(e) }))
      .then((res) => {
        if (res?.skipped) {
          // The fleet stored no key, so there is nothing to remove.
        } else if (res?.ok) {
          if (!json) out.write('  LLM mode disabled on fleet (key removed).\n');
        } else {
          err.write(`Warning: could not disable LLM mode on the fleet at http://${host}:${port} (${res?.error || 'unknown error'}).\n` +
            'The key may still be configured there. Remove it with:\n' +
            `  curl -s -X POST http://${host}:${port}/api/llm/disable -H 'Content-Type: application/json' -d '{}'\n`);
        }
        return res;
      });
    return pending;
  };
  const handlers = Object.entries(signals).map(([signal, code]) => {
    const handler = () => { disableOnce().finally(() => exit(code)); };
    process.on(signal, handler);
    return [signal, handler];
  });
  try {
    return await body();
  } finally {
    // Handlers stay installed until the disable completes: a Ctrl+C during
    // this last request then waits for it instead of killing it mid-flight.
    await disableOnce();
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
  }
}

/**
 * The chat REPL. Lines are answered one at a time, in order, and the REPL ends
 * only after the last queued turn is answered, so input piped in
 * (`printf 'a\nb\n' | dvaa chat`) gets every reply even though stdin closes
 * right after the last line. Prompts are shown only on an interactive
 * terminal, and never in --json mode, so piped output stays parseable.
 */
export async function runRepl(baseUrl, agent, { json = false } = {}, {
  input = process.stdin,
  output = process.stdout,
  send = sendTurn,
  render = (turn) => renderTurn(turn, agent, json, output),
} = {}) {
  const interactive = Boolean(input.isTTY) && !json;
  if (!json) {
    output.write([
      '',
      `  dvaa chat - ${agent.name} (${agent.id}) at ${baseUrl}`,
      `  AIM enforced: ${agent.aimEnforced ? 'yes (' + (agent.aimCapabilities || []).join(', ') + ')' : 'no'}`,
      `  Type a message and press enter. Ctrl+C or "exit" to quit.`,
      '',
    ].join('\n') + '\n');
  }

  const rl = readline.createInterface({
    input,
    output: interactive ? output : undefined,
    prompt: '> ',
    terminal: interactive && Boolean(output.isTTY),
  });
  let stopped = false;
  const prompt = () => { if (interactive && !stopped) rl.prompt(); };

  let queue = Promise.resolve();
  rl.on('line', (line) => {
    queue = queue.then(async () => {
      if (stopped) return;
      const msg = line.trim();
      if (!msg) { prompt(); return; }
      if (msg === 'exit' || msg === 'quit') { stopped = true; rl.close(); return; }
      const turn = await send(baseUrl, msg);
      render(turn);
      prompt();
    });
  });
  prompt();

  await new Promise((resolve) => rl.once('close', resolve));
  await queue;
  stopped = true;
  if (!json) output.write('\n');
  return 0;
}

function enableLlmOnFleet(host, apiKey) {
  return postDashboard(host, '/api/llm/configure', {
    provider: 'anthropic',
    apiKey,
    model: process.env.DVAA_LLM_MODEL || undefined,
  }).then((r) => (r.ok
    ? { ok: true, provider: r.body.provider, model: r.body.model }
    : { ok: false, error: r.error, status: r.status }));
}

/** POST /api/llm/disable: removes the key from the fleet and turns LLM mode off. */
export function disableLlmOnFleet(host, port = DASHBOARD_PORT) {
  return postDashboard(host, '/api/llm/disable', {}, port);
}

function postDashboard(host, path, payload, port = DASHBOARD_PORT) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: host,
      port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch { /* leave null */ }
        if (res.statusCode === 200 && parsed) {
          resolve({ ok: true, body: parsed });
        } else {
          const detail = (parsed && parsed.error) || raw.slice(0, 200) || `HTTP ${res.statusCode}`;
          resolve({ ok: false, error: detail, status: res.statusCode });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.code || e.message }));
    req.write(body);
    req.end();
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

function renderTurn(turn, agent, json, out = process.stdout) {
  if (json) {
    out.write(JSON.stringify(turn, null, 2) + '\n');
    return;
  }
  if (!turn.ok) {
    out.write(`  [error] ${turn.error || ('HTTP ' + turn.statusCode)}\n`);
    return;
  }
  const p = turn.payload || {};
  out.write('\n' + (p.response || '(empty)') + '\n');
  if (Array.isArray(p.toolCalls) && p.toolCalls.length > 0) {
    out.write('\n  tool calls:\n');
    for (const tc of p.toolCalls) {
      const args = typeof tc.function?.arguments === 'string'
        ? tc.function.arguments
        : JSON.stringify(tc.function?.arguments);
      const truncated = args && args.length > 140 ? args.slice(0, 137) + '...' : args;
      out.write(`    - ${tc.function?.name}(${truncated || ''})\n`);
    }
  }
  if (p.dvaa) {
    const d = p.dvaa;
    const aim = d.aim;
    if (aim && aim.enforced) {
      const verdict = aim.allowed ? 'allowed' : 'denied';
      out.write(`\n  AIM: ${verdict}`);
      if (aim.denialReason) out.write(`  reason: ${aim.denialReason}`);
      if (aim.auditEventId) out.write(`  audit: ${aim.auditEventId}`);
      if (aim.trustScore) out.write(`  trust: ${aim.trustScore.score}/100 (${aim.trustScore.grade})`);
      out.write('\n');
    } else if (aim && aim.enforced === false) {
      out.write(`\n  AIM: not enforced for this agent\n`);
    }
    if (d.webFetchUrl) {
      out.write(`  web_fetch: ${d.webFetchUrl}  (${d.webFetchSource || 'unknown'})\n`);
    }
    if (d.httpPostTargetUrl) {
      const fired = d.httpPostExecuted ? 'fired' : 'blocked';
      const status = d.httpPostResult?.statusCode != null ? ` (HTTP ${d.httpPostResult.statusCode})` : '';
      out.write(`  http_post: ${fired}${status}  ${d.httpPostTargetUrl.slice(0, 100)}${d.httpPostTargetUrl.length > 100 ? '...' : ''}\n`);
    }
  }
  out.write('\n');
}
