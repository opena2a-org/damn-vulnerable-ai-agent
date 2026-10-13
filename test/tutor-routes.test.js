/**
 * Tutor route status codes (issue #125).
 *
 * Bad input is a 400, input over a length limit a 413, a provider failure a
 * 502 and any other error a 500 that is logged and shows no detail. Drives
 * the real dashboard server in-process on 127.0.0.1 port 0; provider calls
 * go to a stubbed fetch and never leave the process.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The server keeps scores under <cwd>/.dvaa; keep them out of the checkout.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-tutor-routes-test-'));
process.chdir(workDir);
after(() => fs.rmSync(workDir, { recursive: true, force: true }));

const { createDashboardServer } = await import('../src/dashboard/server.js');
const { configureLLM, disableLLM } = await import('../src/llm/provider.js');

const FAKE_KEY = 'sk-FAKE-tutor-routes-0000';
const realFetch = globalThis.fetch;

async function withServer(fn) {
  const server = createDashboardServer({
    stats: { startedAt: Date.now(), totalRequests: 0, attacksDetected: 0, attacksSuccessful: 0, byAgent: {}, byCategory: {} },
    attackLog: [],
    challengeState: {},
    agents: [],
    logAttack: () => {},
    sandbox: null,
    teamName: `tutor-routes-${process.pid}`,
    timerMinutes: 0,
    track: () => {},
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(server.address().port);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function post(port, route, body) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'POST',
      path: route,
      headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      agent: false,
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, text, json: JSON.parse(text) });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout: ${route}`)));
    req.on('error', reject);
    req.end(payload);
  });
}

const show = (res) => `${res.status} ${res.text.slice(0, 300)}`;

const GUIDANCE = { sessionId: 'tutor-routes', agentId: 'helperbot', userInput: 'hello', agentResponse: 'hi' };

test('bad input is a 400 with its message', async () => {
  await withServer(async (port) => {
    const cases = [
      ['/api/tutor/ask', { sessionId: 'tutor-routes' }, 'question is required'],
      ['/api/tutor/ask', { question: 'What next?' }, /^sessionId must be/],
      ['/api/tutor/guidance', { sessionId: 'tutor-routes' }, 'userInput is required'],
      ['/api/tutor/guidance', { ...GUIDANCE, userInput: 42 }, 'userInput must be a string'],
      ['/api/tutor/ask', 'null', 'Request body must be a JSON object'],
      ['/api/tutor/guidance', '[]', 'Request body must be a JSON object'],
      ['/api/tutor/reset', '"x"', 'Request body must be a JSON object'],
      ['/api/tutor/ask', '{"question":', /^Request body is not valid JSON/],
    ];
    for (const [route, body, message] of cases) {
      const res = await post(port, route, body);
      assert.equal(res.status, 400, `${route} ${JSON.stringify(body)}: ${show(res)}`);
      if (typeof message === 'string') assert.equal(res.json.error, message);
      else assert.match(res.json.error, message);
    }
  });
});

test('input over the length limit is a 413', async () => {
  await withServer(async (port) => {
    const long = 'x'.repeat(20001);
    for (const [route, body] of [
      ['/api/tutor/ask', { sessionId: 'tutor-routes', question: long }],
      ['/api/tutor/ask', { sessionId: 'tutor-routes', question: 'What next?', context: long }],
      ['/api/tutor/guidance', { ...GUIDANCE, userInput: long }],
    ]) {
      const res = await post(port, route, body);
      assert.equal(res.status, 413, `${route}: ${show(res)}`);
      assert.match(res.json.error, /is longer than 20000 characters$/);
    }
  });
});

test('a provider failure is a 502 that quotes neither the provider nor the key', async (t) => {
  configureLLM({ provider: 'openai', apiKey: FAKE_KEY, model: 'gpt-test' });
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    calls.push(url);
    return new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${FAKE_KEY}` } }), { status: 401 });
  };
  t.mock.method(console, 'error', () => {});
  t.after(() => { globalThis.fetch = realFetch; disableLLM(); });

  await withServer(async (port) => {
    for (const [route, body] of [
      ['/api/tutor/ask', { sessionId: 'tutor-routes', question: 'What next?' }],
      ['/api/tutor/guidance', GUIDANCE],
    ]) {
      const res = await post(port, route, body);
      assert.equal(res.status, 502, `${route}: ${show(res)}`);
      assert.equal(res.json.error, 'The LLM provider did not answer. Check the server log, the API key and the model.');
      assert.ok(!res.text.includes('sk-FAKE') && !res.text.includes('Incorrect API key'), res.text);
    }
  });
  assert.equal(calls.length, 2);
});

test('an unexpected error is a 500 that is logged and shows no detail', async (t) => {
  // Serializing the route's answer throws, as a fault in the server would.
  const stringify = JSON.stringify;
  t.mock.method(JSON, 'stringify', function (value, ...rest) {
    if (value && typeof value === 'object' && ('answer' in value || 'killChainProgress' in value || value.status === 'reset')) {
      throw new TypeError('internal fault at /srv/dvaa/secret-path.js:1');
    }
    return stringify.call(this, value, ...rest);
  });
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.map(String).join(' ')));

  await withServer(async (port) => {
    for (const [route, body] of [
      ['/api/tutor/ask', { sessionId: 'tutor-routes', question: 'What next?' }],
      ['/api/tutor/guidance', GUIDANCE],
      ['/api/tutor/reset', { sessionId: 'tutor-routes' }],
    ]) {
      logged.length = 0;
      const res = await post(port, route, body);
      assert.equal(res.status, 500, `${route}: ${show(res)}`);
      assert.deepEqual(res.json, { error: 'Internal server error' });
      assert.ok(!res.text.includes('secret-path') && !res.text.includes('TypeError'), res.text);
      assert.equal(logged.length, 1, logged.join('\n'));
      assert.match(logged[0], new RegExp(`^\\[tutor\\] ${route} failed: TypeError: internal fault`), logged[0]);
    }
  });
});

test('a working tutor route still answers 200', async () => {
  await withServer(async (port) => {
    const ask = await post(port, '/api/tutor/ask', { sessionId: 'tutor-routes', question: 'What next?' });
    assert.equal(ask.status, 200, show(ask));
    assert.deepEqual(ask.json, { answer: null, message: 'LLM not configured' });
    const guidance = await post(port, '/api/tutor/guidance', GUIDANCE);
    assert.equal(guidance.status, 200, show(guidance));
    assert.equal(guidance.json.offline, true);
    const reset = await post(port, '/api/tutor/reset', { sessionId: 'tutor-routes' });
    assert.equal(reset.status, 200, show(reset));
  });
});
