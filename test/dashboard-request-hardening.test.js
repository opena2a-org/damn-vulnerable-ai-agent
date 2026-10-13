/**
 * Dashboard request handling (#92, #93).
 *
 * The dashboard on :9000 is the learner's own tool, and it shares a process
 * with every agent, so:
 *   - a malformed request must never take the process down;
 *   - state-changing endpoints must refuse cross-origin and DNS-rebinding
 *     callers, and accept JSON only;
 *   - client body errors are the client's fault (400), not the agent's (502).
 *
 * Drives the real dashboard server in-process on 127.0.0.1 port 0. It needs
 * no fleet and never binds 7001-7023 or 9000.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The server keeps scores under <cwd>/.dvaa. Run from a throwaway directory so
// verify attempts never write into the checkout.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-dashboard-test-'));
process.chdir(workDir);
after(() => fs.rmSync(workDir, { recursive: true, force: true }));

const { createDashboardServer } = await import('../src/dashboard/server.js');
const { getAllChallenges } = await import('../src/challenges/index.js');

const JSON_TYPE = { 'Content-Type': 'application/json' };

function makeCtx(overrides = {}) {
  return {
    stats: {
      startedAt: Date.now(),
      totalRequests: 3,
      attacksDetected: 2,
      attacksSuccessful: 1,
      byAgent: { helperbot: { requests: 3, attacks: 2, successful: 1 } },
      byCategory: { promptInjection: { detected: 2, successful: 1 } },
    },
    attackLog: [{
      timestamp: Date.now(),
      agentName: 'HelperBot',
      categories: ['promptInjection'],
      successful: true,
      inputPreview: 'ignore previous instructions',
    }],
    challengeState: { 'kept-challenge': { attempts: 1, completedAt: 1700000000000 } },
    agents: [],
    logAttack: () => {},
    sandbox: null,
    teamName: `hardening-${process.pid}`,
    timerMinutes: 0,
    track: () => {},
    ...overrides,
  };
}

async function withServer(overrides, fn) {
  const ctx = makeCtx(overrides);
  const server = createDashboardServer(ctx);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await fn({ port, ctx });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/**
 * Plain node:http rather than fetch, which adds headers of its own: Origin,
 * Sec-Fetch-Site and Content-Type are only what each test sets.
 */
function send(port, { method = 'GET', path: reqPath = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path: reqPath,
      headers: payload ? { ...headers, 'Content-Length': payload.length } : headers,
      agent: false,
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${method} ${reqPath}`)));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const show = (res) => `${res.status} ${res.text.slice(0, 300)}`;

async function assertAlive(port) {
  const res = await send(port, { path: '/health' });
  assert.equal(res.status, 200, `server stopped serving: ${show(res)}`);
}

// ---------------------------------------------------------------------------
// #92: malformed requests never crash the process
// ---------------------------------------------------------------------------

test('a malformed percent-escape in a scenario path returns 400', async () => {
  await withServer({}, async ({ port }) => {
    const bad = '%E0%A4%A';
    for (const [method, reqPath] of [
      ['GET', `/api/scenarios/${bad}/files`],
      ['GET', `/api/scenarios/${bad}/file?path=README.md`],
      ['POST', `/api/scenarios/${bad}/scan`],
      ['POST', `/api/scenarios/${bad}/fix`],
    ]) {
      const res = await send(port, { method, path: reqPath, headers: JSON_TYPE, body: method === 'POST' ? '{}' : undefined });
      assert.equal(res.status, 400, `${method} ${reqPath}: ${show(res)}`);
      assert.match(res.json?.error || '', /percent-encoding/i, show(res));
    }
    await assertAlive(port);
  });
});

test('reading a directory through the scenario file endpoint returns 400', async () => {
  await withServer({}, async ({ port }) => {
    const scenarios = (await send(port, { path: '/api/scenarios' })).json;
    let target = null;
    for (const s of scenarios) {
      const files = (await send(port, { path: `/api/scenarios/${encodeURIComponent(s.name)}/files` })).json;
      if (Array.isArray(files) && files.length) { target = { name: s.name, files }; break; }
    }
    assert.ok(target, 'expected at least one scenario with fixture files');

    const dirs = new Set(['', '.']);
    for (const f of target.files) {
      const dir = path.dirname(f.path);
      if (dir !== '.') dirs.add(dir);
    }
    for (const dir of dirs) {
      const res = await send(port, { path: `/api/scenarios/${encodeURIComponent(target.name)}/file?path=${encodeURIComponent(dir)}` });
      assert.equal(res.status, 400, `directory "${dir}": ${show(res)}`);
      assert.match(res.json?.error || '', /not a file/i, show(res));
    }

    // A real file still reads.
    const file = target.files[0].path;
    const ok = await send(port, { path: `/api/scenarios/${encodeURIComponent(target.name)}/file?path=${encodeURIComponent(file)}` });
    assert.equal(ok.status, 200, show(ok));
    assert.equal(ok.json.path, file);
    await assertAlive(port);
  });
});

test('a malformed Host header does not crash the server', async () => {
  await withServer({}, async ({ port }) => {
    for (const host of ['[', 'a b', '[::1']) {
      const res = await send(port, { path: '/agents', headers: { Host: host } });
      assert.equal(res.status, 200, `Host "${host}": ${show(res)}`);
    }
    await assertAlive(port);
  });
});

test('a malformed absolute-form request target returns 400', async () => {
  await withServer({}, async ({ port }) => {
    for (const target of ['http://[', 'http://%zz/', 'http://[::1/x']) {
      const head = await new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
        });
        // Without a deadline, a server that never answers hangs the suite.
        socket.setTimeout(5000, () => socket.destroy(new Error(`timeout: GET ${target}`)));
        let raw = '';
        socket.on('data', (d) => { raw += d; });
        socket.on('end', () => resolve(raw));
        socket.on('error', reject);
      });
      assert.match(head, /^HTTP\/1\.1 400 /, `${target}: ${head.slice(0, 200)}`);
      assert.match(head, /Malformed request URL/, `${target}: ${head.slice(0, 200)}`);
    }
    await assertAlive(port);
  });
});

test('an unexpected error inside a route returns 500 JSON and the server keeps serving', async () => {
  // An agent record without a securityLevel makes GET /agents throw.
  await withServer({ agents: [{ id: 'broken', name: 'Broken', port: 1 }] }, async ({ port }) => {
    const res = await send(port, { path: '/agents' });
    assert.equal(res.status, 500, show(res));
    assert.equal(res.headers['content-type'], 'application/json');
    assert.equal(res.json?.error, 'Internal server error', show(res));
    await assertAlive(port);
  });
});

// ---------------------------------------------------------------------------
// #92: cross-origin and DNS-rebinding callers
// ---------------------------------------------------------------------------

test('responses carry no CORS headers and OPTIONS is not answered with 200', async () => {
  await withServer({}, async ({ port }) => {
    const health = await send(port, { path: '/health' });
    assert.equal(health.headers['access-control-allow-origin'], undefined);

    const preflight = await send(port, {
      method: 'OPTIONS',
      path: '/api/reset',
      headers: {
        Origin: 'http://evil.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 405, show(preflight));
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
    assert.equal(preflight.headers['access-control-allow-methods'], undefined);
  });
});

test('state-changing requests must declare a JSON body', async () => {
  await withServer({}, async ({ port, ctx }) => {
    // text/plain is what a cross-site page can send without a preflight.
    for (const headers of [{ 'Content-Type': 'text/plain' }, {}, { 'Content-Type': 'application/x-www-form-urlencoded' }]) {
      const res = await send(port, { method: 'POST', path: '/api/reset', headers, body: '{}' });
      assert.equal(res.status, 415, `${JSON.stringify(headers)}: ${show(res)}`);
    }
    assert.equal(ctx.attackLog.length, 1, 'a refused reset must not clear the attack log');
    assert.ok(ctx.challengeState['kept-challenge'], 'a refused reset must not clear progress');

    const ok = await send(port, { method: 'POST', path: '/api/reset', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{}' });
    assert.equal(ok.status, 200, show(ok));
    assert.equal(ctx.attackLog.length, 0);
  });
});

test('cross-origin callers are refused on state-changing endpoints', async () => {
  await withServer({}, async ({ port, ctx }) => {
    const refused = [
      { Origin: 'http://evil.example' },
      { Origin: 'null' },
      { Origin: `http://127.0.0.1:${port + 1}` },
      { 'Sec-Fetch-Site': 'cross-site' },
      { Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const extra of refused) {
      for (const endpoint of ['/api/reset', '/api/llm/disable', '/api/sandbox/reset', '/playground/test']) {
        const res = await send(port, { method: 'POST', path: endpoint, headers: { ...JSON_TYPE, ...extra }, body: '{}' });
        assert.equal(res.status, 403, `${endpoint} ${JSON.stringify(extra)}: ${show(res)}`);
      }
    }
    assert.equal(ctx.attackLog.length, 1, 'a refused reset must not clear the attack log');

    // The dashboard page itself: same origin, as a browser sends it.
    const ok = await send(port, {
      method: 'POST',
      path: '/api/reset',
      headers: { ...JSON_TYPE, Origin: `http://127.0.0.1:${port}`, 'Sec-Fetch-Site': 'same-origin' },
      body: '{}',
    });
    assert.equal(ok.status, 200, show(ok));
    assert.equal(ctx.attackLog.length, 0);
  });
});

test('a non-loopback Host is refused unless DVAA_HOST opts in to exposure', async () => {
  const saved = process.env.DVAA_HOST;
  try {
    await withServer({}, async ({ port }) => {
      const rebind = { ...JSON_TYPE, Host: 'rebind.example:9000', Origin: 'http://rebind.example:9000' };

      delete process.env.DVAA_HOST;
      let res = await send(port, { method: 'POST', path: '/api/llm/disable', headers: rebind, body: '{}' });
      assert.equal(res.status, 403, `rebinding with DVAA_HOST unset: ${show(res)}`);
      assert.match(res.json?.error || '', /DVAA_HOST/, show(res));

      // Rebinding domains that only look like loopback.
      for (const host of ['localhost.evil.example:9000', '127.0.0.1.nip.io:9000', 'localhost:9000.evil.example', 'evil.example']) {
        res = await send(port, { method: 'POST', path: '/api/llm/disable', headers: { ...JSON_TYPE, Host: host }, body: '{}' });
        assert.equal(res.status, 403, `look-alike Host "${host}": ${show(res)}`);
      }

      for (const host of ['localhost:9000', 'LOCALHOST', '127.0.0.1', '127.0.0.1:9000', '[::1]:9000', '[::1]']) {
        res = await send(port, { method: 'POST', path: '/api/llm/disable', headers: { ...JSON_TYPE, Host: host }, body: '{}' });
        assert.equal(res.status, 200, `loopback Host "${host}": ${show(res)}`);
      }

      process.env.DVAA_HOST = '127.0.0.1';
      res = await send(port, { method: 'POST', path: '/api/llm/disable', headers: rebind, body: '{}' });
      assert.equal(res.status, 403, `rebinding with a loopback DVAA_HOST: ${show(res)}`);

      process.env.DVAA_HOST = '0.0.0.0';
      res = await send(port, { method: 'POST', path: '/api/llm/disable', headers: rebind, body: '{}' });
      assert.equal(res.status, 200, `deliberate exposure: ${show(res)}`);
      res = await send(port, {
        method: 'POST',
        path: '/api/llm/disable',
        headers: { ...JSON_TYPE, Host: '192.168.1.20:9000', Origin: 'http://evil.example' },
        body: '{}',
      });
      assert.equal(res.status, 403, `exposure still checks Origin: ${show(res)}`);
    });
  } finally {
    if (saved === undefined) delete process.env.DVAA_HOST;
    else process.env.DVAA_HOST = saved;
  }
});

test('PUT, PATCH and DELETE pass through the same gate', async () => {
  await withServer({}, async ({ port }) => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      let res = await send(port, { method, path: '/api/reset', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
      assert.equal(res.status, 415, `${method} text/plain: ${show(res)}`);
      res = await send(port, { method, path: '/api/reset', headers: { ...JSON_TYPE, Origin: 'http://evil.example' }, body: '{}' });
      assert.equal(res.status, 403, `${method} cross-origin: ${show(res)}`);
      res = await send(port, { method, path: '/api/reset', headers: JSON_TYPE, body: '{}' });
      assert.equal(res.status, 404, `${method} same-origin reaches routing: ${show(res)}`);
    }
  });
});

test('a refused request is not counted as a user action', async () => {
  const sent = [];
  await withServer({ track: (name) => sent.push(name) }, async ({ port }) => {
    await send(port, { method: 'POST', path: '/api/reset', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    await send(port, { method: 'POST', path: '/api/reset', headers: { ...JSON_TYPE, Origin: 'http://evil.example' }, body: '{}' });
    assert.deepEqual(sent, []);
    await send(port, { method: 'POST', path: '/api/reset', headers: JSON_TYPE, body: '{}' });
    assert.deepEqual(sent, ['lab-reset']);
  });
});

test('the request shape dvaa chat --llm sends is accepted', async () => {
  // src/cli/commands/chat.js enableLlmOnFleet(): node:http, Host localhost:9000,
  // JSON body, no Origin and no Sec-Fetch-* headers.
  await withServer({}, async ({ port }) => {
    try {
      const res = await send(port, {
        method: 'POST',
        path: '/api/llm/configure',
        headers: { ...JSON_TYPE, Host: 'localhost:9000' },
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'test-key-not-real' }),
      });
      assert.equal(res.status, 200, show(res));
      assert.equal(res.json.status, 'configured');
      assert.equal(res.json.apiKey, undefined, 'the key is never echoed back');
    } finally {
      const off = await send(port, { method: 'POST', path: '/api/llm/disable', headers: { ...JSON_TYPE, Host: 'localhost:9000' }, body: '{}' });
      assert.equal(off.status, 200, show(off));
    }
  });
});

// ---------------------------------------------------------------------------
// #92: chat proxy reports client errors as 400, upstream failures as 502
// ---------------------------------------------------------------------------

test('chat proxy: client body errors are 400, upstream failures are 502', async () => {
  const received = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, JSON_TYPE);
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));

  // A port with nothing listening on it.
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
  const deadPort = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));

  try {
    const agents = [
      { id: 'echo', name: 'Echo', port: upstream.address().port },
      { id: 'down', name: 'Down', port: deadPort },
    ];
    await withServer({ agents }, async ({ port }) => {
      const chat = (id, body) => send(port, { method: 'POST', path: `/api/agents/${id}/chat`, headers: JSON_TYPE, body });

      let res = await chat('echo', '{"message": "unterminated');
      assert.equal(res.status, 400, `invalid JSON: ${show(res)}`);
      assert.match(res.json?.error || '', /JSON/, show(res));

      res = await chat('echo', '["not", "an", "object"]');
      assert.equal(res.status, 400, `array body: ${show(res)}`);
      assert.match(res.json?.error || '', /JSON object/, show(res));

      res = await chat('echo', JSON.stringify({ messages: 'hello' }));
      assert.equal(res.status, 400, `messages not an array: ${show(res)}`);
      assert.match(res.json?.error || '', /messages/, show(res));

      res = await chat('echo', JSON.stringify({ message: 'x'.repeat(1024 * 1024 + 16) }));
      assert.equal(res.status, 413, `oversized body: ${show(res)}`);

      assert.equal(received.length, 0, 'no client error may reach the agent');

      res = await chat('echo', JSON.stringify({ message: 'ping' }));
      assert.equal(res.status, 200, show(res));
      assert.equal(res.json.choices[0].message.content, 'pong');
      assert.deepEqual(received[0].messages, [{ role: 'user', content: 'ping' }]);

      res = await chat('down', JSON.stringify({ message: 'ping' }));
      assert.equal(res.status, 502, `agent unreachable: ${show(res)}`);
      assert.equal(res.json?.error, 'Agent request failed', show(res));
    });
  } finally {
    upstream.closeAllConnections?.();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// #92: challenge verify needs a string response (host note)
// ---------------------------------------------------------------------------

test('challenge verify returns 400 unless response is a string', async () => {
  const challenge = getAllChallenges().find((c) => !c.successCriteria?.manual);
  assert.ok(challenge, 'expected an automatically verified challenge');
  await withServer({ challengeState: {} }, async ({ port, ctx }) => {
    const verify = (body) => send(port, {
      method: 'POST',
      path: `/api/challenges/${encodeURIComponent(challenge.id)}/verify`,
      headers: JSON_TYPE,
      body: JSON.stringify(body),
    });

    for (const body of [{}, { answer: 'x' }, { response: { text: 'x' } }, { response: 42 }, { response: null }]) {
      const res = await verify(body);
      assert.equal(res.status, 400, `${JSON.stringify(body)}: ${show(res)}`);
      assert.match(res.json?.error || '', /"response"/, show(res));
    }
    assert.equal(ctx.challengeState[challenge.id], undefined, 'a rejected body is not an attempt');

    const res = await verify({ response: 'a plain wrong answer' });
    assert.equal(res.status, 200, show(res));
    assert.equal(typeof res.json.success, 'boolean');
    assert.equal(res.json.attempts, 1);
  });
});

// ---------------------------------------------------------------------------
// #93: Clear log leaves progress alone
// ---------------------------------------------------------------------------

test('clearing the attack log leaves progress and stats alone', async () => {
  await withServer({}, async ({ port, ctx }) => {
    const res = await send(port, { method: 'POST', path: '/api/attack-log/clear', headers: JSON_TYPE, body: '{}' });
    assert.equal(res.status, 200, show(res));
    assert.equal(res.json.status, 'cleared');
    assert.equal(ctx.attackLog.length, 0);
    assert.ok(ctx.challengeState['kept-challenge'], 'challenge progress must survive a log clear');
    assert.equal(ctx.stats.totalRequests, 3, 'stats must survive a log clear');

    const refused = await send(port, { method: 'POST', path: '/api/attack-log/clear', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(refused.status, 415, show(refused));
  });
});
