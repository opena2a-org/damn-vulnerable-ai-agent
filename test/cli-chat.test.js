/**
 * dvaa chat (#96, #97): the --llm key is removed from the fleet however chat
 * ends, piped input is answered line by line, and chat accepts the names
 * `dvaa agents` shows.
 *
 * In-process tests use mock servers on 127.0.0.1 port 0 and a fake key; no
 * real provider and no shared port is touched. The live tests run only when a
 * fleet answers (the container harness) and never enable LLM mode on it.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveChatAgent, runRepl, withLlmDisabledOnExit, disableLlmOnFleet, chatWithFleetLlm } from '../src/cli/commands/chat.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sink = () => { const s = new PassThrough(); let text = ''; s.on('data', c => { text += c; }); return { stream: s, text: () => text }; };

// ---- the key's lifetime on the fleet ---------------------------------------

test('the key is disabled after one-shot mode returns', async () => {
  const calls = [];
  const out = sink();
  const code = await withLlmDisabledOnExit(async () => { calls.push('disable'); return { ok: true }; },
    async () => { calls.push('turn'); return 0; },
    { out: out.stream, err: out.stream, signals: {} });
  assert.equal(code, 0);
  assert.deepEqual(calls, ['turn', 'disable']);
  assert.match(out.text(), /LLM mode disabled on fleet/);
});

test('the key is disabled when the chat body throws', async () => {
  let disabled = 0;
  const out = sink();
  await assert.rejects(withLlmDisabledOnExit(async () => { disabled++; return { ok: true }; },
    async () => { throw new Error('boom'); }, { out: out.stream, err: out.stream, signals: {} }), /boom/);
  assert.equal(disabled, 1);
});

test('SIGINT, SIGTERM and SIGHUP are handled while the key is on the fleet', async () => {
  const before = Object.fromEntries(['SIGINT', 'SIGTERM', 'SIGHUP'].map(s => [s, process.listenerCount(s)]));
  const out = sink();
  await withLlmDisabledOnExit(async () => ({ ok: true }), async () => {
    for (const s of Object.keys(before)) {
      assert.equal(process.listenerCount(s), before[s] + 1, `${s} must be handled while chat runs`);
    }
    return 0;
  }, { out: out.stream, err: out.stream });
  for (const s of Object.keys(before)) {
    assert.equal(process.listenerCount(s), before[s], `${s} handler must be removed afterwards`);
  }
});

test('a signal during the final disable waits for it instead of killing it', async () => {
  const events = [];
  let finish;
  const slowDisable = new Promise(r => { finish = r; });
  const out = sink();
  const run = withLlmDisabledOnExit(
    async () => { events.push('disable-start'); await slowDisable; events.push('disable-done'); return { ok: true }; },
    async () => 0, // the reply is already printed
    { out: out.stream, err: out.stream, signals: { 'dvaa-test-signal-2': 130 }, exit: (code) => events.push(`exit:${code}`) },
  );
  await sleep(10);
  assert.equal(process.listenerCount('dvaa-test-signal-2'), 1, 'still handled while the disable is in flight');
  process.emit('dvaa-test-signal-2');
  finish();
  await run;
  await sleep(10);
  assert.deepEqual(events, ['disable-start', 'disable-done', 'exit:130']);
});

test('a signal mid-turn disables the key, then exits with the signal code', async () => {
  // A stand-in event name: emitting a real SIGINT here would also reach the
  // test runner's own handler.
  const events = [];
  let release;
  const inFlight = new Promise(r => { release = r; });
  const out = sink();
  const run = withLlmDisabledOnExit(
    async () => { events.push('disable'); return { ok: true }; },
    () => inFlight, // a turn that is still waiting for the agent
    {
      out: out.stream, err: out.stream,
      signals: { 'dvaa-test-signal': 130 },
      exit: (code) => { events.push(`exit:${code}`); release(1); },
    },
  );
  process.emit('dvaa-test-signal');
  process.emit('dvaa-test-signal'); // a second Ctrl+C must not disable twice
  await run;
  assert.deepEqual(events.slice(0, 2), ['disable', 'exit:130'], 'disable completes before the exit');
  assert.equal(events.filter(e => e === 'disable').length, 1);
});

test('a failed disable says how to remove the key by hand, without printing it', async () => {
  const out = sink();
  const err = sink();
  await withLlmDisabledOnExit(async () => ({ ok: false, error: 'ECONNREFUSED' }), async () => 0,
    { host: 'localhost', port: 9000, out: out.stream, err: err.stream, signals: {} });
  assert.match(err.text(), /could not disable LLM mode .*ECONNREFUSED/);
  assert.match(err.text(), /curl -s -X POST http:\/\/localhost:9000\/api\/llm\/disable/);
});

// The --llm session as `dvaa chat --llm` runs it, with the HTTP calls stubbed.
function llmSession({ enableResult, converse = async () => 0 }) {
  const calls = [];
  const out = sink();
  const run = chatWithFleetLlm({
    host: 'localhost',
    apiKey: 'fake-test-key',
    converse: async () => { calls.push('converse'); return converse(); },
    enable: async (host, key) => { calls.push(`enable:${host}:${key === 'fake-test-key'}`); return enableResult; },
    disable: async (host) => { calls.push(`disable:${host}`); return { ok: true }; },
    cleanup: { out: out.stream, err: out.stream, signals: {} },
  });
  return { calls, run, out };
}

test('chat --llm: configure, converse, then disable', async () => {
  const s = llmSession({ enableResult: { ok: true, provider: 'anthropic', model: 'm' } });
  assert.equal(await s.run, 0);
  assert.deepEqual(s.calls, ['enable:localhost:true', 'converse', 'disable:localhost']);
  assert.doesNotMatch(s.out.text(), /fake-test-key/, 'the key is never printed');
});

test('chat --llm: the key is disabled even when the conversation fails', async () => {
  const s = llmSession({ enableResult: { ok: true }, converse: async () => { throw new Error('agent went away'); } });
  await assert.rejects(s.run, /agent went away/);
  assert.equal(s.calls.at(-1), 'disable:localhost');
});

test('chat --llm: a configure the fleet rejected leaves its LLM settings alone', async () => {
  // HTTP 400 from /api/llm/configure: nothing was stored, so a disable would
  // only remove a key set earlier from the dashboard.
  const s = llmSession({ enableResult: { ok: false, error: 'provider and apiKey are required', status: 400 } });
  assert.equal(await s.run, 1);
  assert.deepEqual(s.calls, ['enable:localhost:true']);
});

test('chat --llm: a configure that timed out may have landed, so it is disabled', async () => {
  const s = llmSession({ enableResult: { ok: false, error: 'timeout' } });
  assert.equal(await s.run, 1);
  assert.deepEqual(s.calls, ['enable:localhost:true', 'disable:localhost']);
});

test('disableLlmOnFleet sends the JSON request the dashboard accepts', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"disabled","enabled":false}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const res = await disableLlmOnFleet('127.0.0.1', srv.address().port);
    assert.equal(res.ok, true);
    assert.deepEqual(seen, [{ method: 'POST', url: '/api/llm/disable', type: 'application/json', body: '{}' }]);
  } finally {
    srv.close();
  }
});

// ---- the REPL with piped input ---------------------------------------------

test('piped input: every line is answered, in order, before the REPL returns', async () => {
  const input = new PassThrough();
  const out = sink();
  const sent = [];
  const rendered = [];
  const done = runRepl('http://127.0.0.1:1', { id: 'helperbot', name: 'HelperBot' }, { json: true }, {
    input,
    output: out.stream,
    send: async (_url, msg) => { sent.push(msg); await sleep(30); return { ok: true, payload: { response: `re:${msg}` } }; },
    render: (turn) => rendered.push(turn.payload.response),
  });
  // Piped stdin: all lines arrive at once, then EOF.
  input.end('first\nsecond\n\nthird\n');
  const code = await done;
  assert.equal(code, 0);
  assert.deepEqual(sent, ['first', 'second', 'third']);
  assert.deepEqual(rendered, ['re:first', 're:second', 're:third']);
  assert.ok(!out.text().includes('> '), `no prompts in piped/--json mode, got: ${JSON.stringify(out.text())}`);
});

test('piped input: lines after "exit" are not sent', async () => {
  const input = new PassThrough();
  const sent = [];
  const done = runRepl('http://127.0.0.1:1', { id: 'helperbot', name: 'HelperBot' }, { json: true }, {
    input,
    output: sink().stream,
    send: async (_url, msg) => { sent.push(msg); return { ok: true, payload: {} }; },
    render: () => {},
  });
  input.end('one\nexit\ntwo\n');
  await done;
  assert.deepEqual(sent, ['one']);
});

// ---- names --------------------------------------------------------------------

test('chat accepts the names `dvaa agents` shows', () => {
  assert.equal(resolveChatAgent('VisionBot').agent?.id, 'multimodal');
  assert.equal(resolveChatAgent('RAGBot-AIM').agent?.id, 'ragbot-aim');
  assert.equal(resolveChatAgent('researchbot').agent?.id, 'researchbot');
});

test('MCP and A2A agents get a next step instead of a dead end', () => {
  const mcp = resolveChatAgent('ToolBot', 'localhost');
  assert.match(mcp.error, /MCP server/);
  assert.match(mcp.error, /tools\/list/);
  assert.match(mcp.error, /dvaa chat list/);
  const a2a = resolveChatAgent('orchestrator', 'localhost');
  assert.match(a2a.error, /a2a\/message/);
  assert.match(resolveChatAgent('nosuchbot').error, /Unknown agent: nosuchbot\nRun: dvaa chat list/);
});

// ---- live (container harness) ----------------------------------------------

async function isUp(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}
const cliEnv = () => ({ PATH: process.env.PATH, HOME: os.tmpdir(), OPENA2A_TELEMETRY: 'off', NO_COLOR: '1' });

test('live: input piped into `dvaa chat` gets a reply for every line', async (t) => {
  if (!(await isUp('http://localhost:7002/health'))) { t.skip('no fleet on :7002'); return; }
  const r = spawnSync(process.execPath, [CLI, 'chat', 'helperbot', '--json'], {
    input: 'hello\nwhat can you do?\nthanks\n', encoding: 'utf-8', env: cliEnv(), timeout: 30_000,
  });
  const show = `exit=${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
  assert.equal(r.status, 0, show);
  const turns = r.stdout.match(/^\{$/gm) || [];
  assert.equal(turns.length, 3, `expected 3 JSON turns, got ${turns.length}: ${show}`);
});

test('live: `dvaa chat VisionBot` reaches the agent `dvaa agents` lists as VisionBot', async (t) => {
  const vision = 7006;
  if (!(await isUp(`http://localhost:${vision}/health`))) { t.skip('no fleet on :7006'); return; }
  const r = spawnSync(process.execPath, [CLI, 'chat', 'VisionBot', '--message', 'hello', '--json'], {
    encoding: 'utf-8', env: cliEnv(), timeout: 30_000,
  });
  const show = `exit=${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
  assert.equal(r.status, 0, show);
  assert.equal(JSON.parse(r.stdout).ok, true, show);
});
