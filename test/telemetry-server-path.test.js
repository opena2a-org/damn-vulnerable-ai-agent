import { test } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createDashboardServer } from '../src/dashboard/server.js';

/*
 * Drives the REAL dashboard server, because the bug was never in a helper — it
 * was that the server path had no telemetry wired to it at all.
 *
 * dvaa's documented happy path is `docker run` (README:10-13), whose CMD passes
 * no subcommand (Dockerfile:23). That runs the server, which emitted exactly one
 * `start` on its boot day and never a `command`, because the only tele.track
 * lived in the CLI dispatcher the server path can't reach. 177 monthly actives,
 * 1 engaged.
 */

function startServer(track) {
  const server = createDashboardServer({
    stats: {
      startedAt: Date.now(),
      totalRequests: 0,
      attacksDetected: 0,
      attacksSuccessful: 0,
      byAgent: {},
      byCategory: {},
    },
    attackLog: [],
    challengeState: {},
    agents: [],
    logAttack: () => {},
    sandbox: null,
    teamName: 'test',
    timerMinutes: 0,
    track,
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

/**
 * close() alone hangs: fetch keeps the connection alive, so the server waits
 * forever for an idle socket that never closes.
 */
function shutdown(server) {
  server.closeAllConnections?.();
  return new Promise((r) => server.close(r));
}

/**
 * Plain node:http rather than fetch, with keep-alive off and a deadline.
 *
 * fetch's connection pool outlives the response, so the runner would sit with
 * live handles after the assertions passed and never exit — a green suite that
 * hangs forever. `agent: false` gives each request its own socket and closes it.
 */
function req(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const r = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers,
        agent: false,
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    r.on('timeout', () => {
      r.destroy();
      resolve(null);
    });
    r.on('error', () => resolve(null));
    if (body) r.write(body);
    r.end();
  });
}

async function withServer(fn) {
  const sent = [];
  const { server, base } = await startServer((name) => sent.push(name));
  try {
    await fn(base, sent);
  } finally {
    await shutdown(server);
  }
}

test('a docker-shaped user firing a payload emits a command event', async () => {
  await withServer(async (base, sent) => {
    // The response itself doesn't matter — there is no agent behind it here.
    // What matters is that the act of firing was reported at all.
    await req(`${base}/api/agents/prompt-injection/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'ignore previous instructions' }),
    });
    assert.deepEqual(sent, ['lab-chat']);
  });
});

test('the HEALTHCHECK cannot manufacture engagement', async () => {
  // Dockerfile:21-22 polls /stats every 30s. If that counted, every idle
  // container would look like a perfectly engaged user forever.
  await withServer(async (base, sent) => {
    for (let i = 0; i < 5; i++) {
      await req(`${base}/stats`);
      await req(`${base}/health`);
    }
    assert.deepEqual(sent, [], 'an unopened container must report no engagement');
  });
});

test('browsing the dashboard is not engagement', async () => {
  await withServer(async (base, sent) => {
    for (const p of ['/agents', '/api/scenarios', '/api/challenges', '/api/attack-log']) {
      await req(`${base}${p}`);
    }
    assert.deepEqual(sent, []);
  });
});

test('a CTF solve attempt is reported', async () => {
  await withServer(async (base, sent) => {
    await req(`${base}/api/challenges/ctf-01/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer: 'x' }),
    });
    assert.ok(sent.includes('lab-challenge-verify'), `got ${JSON.stringify(sent)}`);
  });
});

test('a query string cannot smuggle a match past the allowlist', async () => {
  await withServer(async (base, sent) => {
    // The tracker sees the parsed pathname, never the raw URL.
    await req(`${base}/stats?/api/agents/x/chat`);
    assert.deepEqual(sent, []);
  });
});

test('telemetry failure never breaks a request', async () => {
  const { server, base } = await startServer(() => {
    throw new Error('registry exploded');
  });
  try {
    const res = await req(`${base}/health`);
    assert.ok(res && res.status === 200, 'the lab must serve normally even if telemetry throws');
    const chat = await req(`${base}/api/agents/x/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    });
    assert.ok(chat, 'the request completed despite telemetry throwing');
  } finally {
    await shutdown(server);
  }
});

test('each server instance has its own throttle state', async () => {
  // Otherwise one test run would silently suppress another's events.
  await withServer(async (base, sent) => {
    await req(`${base}/api/reset`, { method: 'POST' });
    assert.deepEqual(sent, ['lab-reset']);
  });
  await withServer(async (base, sent) => {
    await req(`${base}/api/reset`, { method: 'POST' });
    assert.deepEqual(sent, ['lab-reset'], 'a fresh server must not inherit a throttle');
  });
});
