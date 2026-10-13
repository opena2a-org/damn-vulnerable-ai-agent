/**
 * Playground HTTP routes: client errors, provider validation and run
 * failures (issues #94 and #95).
 *
 * Starts the playground routes alone on 127.0.0.1 port 0. No test reaches a
 * provider: provider requests go to a stubbed fetch, and the SDK base URLs
 * point at a closed loopback port as a second guard.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';

const { handlePlaygroundRoutes, MAX_PROMPT_CHARS, MAX_BODY_BYTES } =
  await import('../src/playground/routes.js');

const realFetch = globalThis.fetch;
let server;
let base;

before(async () => {
  server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (!(await handlePlaygroundRoutes(req, res, pathname))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

async function post(path, body, { raw } = {}) {
  const res = await realFetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

/** Answer provider calls with `respond` and count them. */
function stubProvider(t, respond) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input.url ?? String(input));
    if (!url.startsWith('http://127.0.0.1:9/')) return realFetch(input, init);
    calls.push(url);
    return respond(url);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  // Provider failures are logged; keep the test output readable.
  t.mock.method(console, 'error', () => {});
  return calls;
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const unauthorized = () => json(401, {
  error: { message: 'Incorrect API key provided: sk-test-****1234.', type: 'invalid_request_error', code: 'invalid_api_key' }
});

const ROUTES = ['/playground/test', '/playground/apply-recommendations', '/playground/test-connection'];

test('malformed JSON is a 400 on every POST route', async () => {
  for (const route of ROUTES) {
    const { status, json: body } = await post(route, null, { raw: '{"systemPrompt": "x",' });
    assert.equal(status, 400, `${route}: ${JSON.stringify(body)}`);
    assert.equal(body.error, 'Request body is not valid JSON');
  }
});

test('a JSON body that is not an object is a 400', async () => {
  for (const raw of ['null', '[]', '"text"', '42']) {
    const { status, json: body } = await post('/playground/test', null, { raw });
    assert.equal(status, 400, raw);
    assert.equal(body.error, 'Request body must be a JSON object');
  }
});

test('wrong field types are a 400 that names the field', async () => {
  const cases = [
    ['/playground/test', { systemPrompt: 123 }, 'systemPrompt must be a string'],
    ['/playground/test', {}, 'System prompt is required'],
    ['/playground/test', { systemPrompt: 'p', intensity: 'extreme' }, 'intensity must be one of: passive, standard, active, aggressive'],
    ['/playground/test', { systemPrompt: 'p', llmProvider: 5 }, 'llmProvider must be a string'],
    ['/playground/test', { systemPrompt: 'p', llmProvider: 'openai', llmApiKey: 5 }, 'llmApiKey must be a string'],
    ['/playground/test', { systemPrompt: 'p', llmProvider: 'openai', llmApiKey: 'k', llmModel: 5 }, 'llmModel must be a string'],
    ['/playground/apply-recommendations', { systemPrompt: 'p', recommendations: 'all' }, 'Recommendations must be an array'],
    ['/playground/apply-recommendations', { systemPrompt: 'p', recommendations: [1] }, 'recommendations[0] must be an object'],
    ['/playground/apply-recommendations', { systemPrompt: 'p', recommendations: [{ fix: 3 }] }, 'recommendations[0].fix must be a string'],
  ];
  for (const [route, body, message] of cases) {
    const res = await post(route, body);
    assert.equal(res.status, 400, `${route} ${JSON.stringify(body)}: ${res.text}`);
    assert.equal(res.json.error, message);
  }
});

test('an over-limit body is a 413', async () => {
  const raw = JSON.stringify({ systemPrompt: 'a'.repeat(MAX_BODY_BYTES) });
  const res = await post('/playground/test', null, { raw });
  assert.equal(res.status, 413, res.text);
  assert.equal(res.json.error, `Request body is larger than ${MAX_BODY_BYTES} bytes`);
});

test('a system prompt over 20,000 characters is a 413', async () => {
  assert.equal(MAX_PROMPT_CHARS, 20000);
  for (const route of ['/playground/test', '/playground/apply-recommendations']) {
    const res = await post(route, { systemPrompt: 'a'.repeat(MAX_PROMPT_CHARS + 1) });
    assert.equal(res.status, 413, `${route}: ${res.text}`);
    assert.equal(res.json.error, 'System prompt is 20001 characters; the limit is 20000');
  }
  const atLimit = await post('/playground/test', { systemPrompt: 'a'.repeat(MAX_PROMPT_CHARS) });
  assert.equal(atLimit.status, 200, atLimit.text);
});

test('a real provider with an empty key is a 400, never a simulated run', async (t) => {
  const calls = stubProvider(t, unauthorized);
  for (const llmApiKey of [undefined, '', '   ']) {
    const res = await post('/playground/test', { systemPrompt: 'p', llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKey });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.error, 'An API key is required for OpenAI. Add one in Settings, or switch to Simulated.');
  }
  assert.equal(calls.length, 0);
});

test('an unknown provider is a 400 on the test and the connection test', async (t) => {
  const calls = stubProvider(t, unauthorized);
  for (const route of ['/playground/test', '/playground/test-connection']) {
    const res = await post(route, { systemPrompt: 'p', llmProvider: 'bogus', llmApiKey: 'k' });
    assert.equal(res.status, 400, `${route}: ${res.text}`);
    assert.equal(res.json.error, 'Unknown llmProvider. Use simulated, openai or anthropic.');
    assert.equal(res.json.success, false);
  }
  assert.equal(calls.length, 0);
});

test('the connection test needs a real provider', async () => {
  for (const body of [{}, { llmProvider: 'simulated', llmApiKey: 'k' }]) {
    const res = await post('/playground/test-connection', body);
    assert.equal(res.status, 400, res.text);
    assert.equal(res.json.success, false);
  }
});

test('a rejected key fails the connection test with a 502 and no key fragment', async (t) => {
  const calls = stubProvider(t, unauthorized);
  const res = await post('/playground/test-connection', { llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKey: 'sk-test-abcd1234' });
  assert.equal(calls.length, 1);
  assert.equal(res.status, 502, res.text);
  assert.equal(res.json.success, false);
  assert.equal(res.json.error, 'Connection failed: OpenAI returned HTTP 401: check the API key');
  assert.ok(!res.text.includes('sk-test'), res.text);
});

test('a working key passes the connection test', async (t) => {
  stubProvider(t, () => json(200, {
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6',
    content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 }
  }));
  const res = await post('/playground/test-connection', { llmProvider: 'anthropic', llmApiKey: 'k' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.success, true);
  assert.equal(res.json.provider, 'anthropic');
});

test('a run where every attack fails is a 502 with the reason, not a score', async (t) => {
  const calls = stubProvider(t, unauthorized);
  const res = await post('/playground/test', { systemPrompt: 'p', llmProvider: 'openai', llmModel: 'gpt-4o', llmApiKey: 'sk-test-abcd1234' });
  assert.equal(calls.length, 9);
  assert.equal(res.status, 502, res.text);
  assert.equal(res.json.success, false);
  assert.equal(res.json.error, 'Every attack failed, so no score was computed. OpenAI returned HTTP 401: check the API key.');
  assert.equal(res.json.results, undefined);
});

test('a simulated run returns the mode, a verdict per attack and recommendations', async (t) => {
  const calls = stubProvider(t, unauthorized);
  // A key sent with the simulated provider is ignored.
  const res = await post('/playground/test', { systemPrompt: 'You are a helpful assistant.', llmProvider: 'simulated', llmApiKey: 'k' });
  assert.equal(res.status, 200, res.text);
  const { results } = res.json;
  assert.equal(results.mode, 'simulated');
  assert.equal(results.attacks.length, 9);
  for (const attack of results.attacks) {
    assert.ok(['blocked', 'vulnerable', 'inconclusive'].includes(attack.verdict), JSON.stringify(attack));
  }
  const { blocked, vulnerable, inconclusive } = results.counts;
  assert.equal(blocked + vulnerable + inconclusive, 9);
  assert.ok(Array.isArray(results.recommendations) && results.recommendations.length > 0);
  assert.equal(calls.length, 0);
});

test('apply-recommendations returns the prompt with the instructions and no "Add" wrappers', async () => {
  const systemPrompt = 'You are a helpful assistant.';
  const tested = await post('/playground/test', { systemPrompt });
  const { recommendations } = tested.json.results;
  assert.ok(recommendations.some(r => /^Add preamble:/.test(r.fix)));

  const res = await post('/playground/apply-recommendations', { systemPrompt, recommendations });
  assert.equal(res.status, 200, res.text);
  assert.ok(!/\bAdd( preamble)?:/.test(res.json.enhanced), res.json.enhanced);
  assert.ok(res.json.enhanced.startsWith('META-INSTRUCTIONS (IMMUTABLE):'), res.json.enhanced);
  assert.ok(res.json.enhanced.includes(systemPrompt));
});

test('library routes still answer', async () => {
  const all = await realFetch(`${base}/playground/library`);
  assert.equal(all.status, 200);
  assert.ok((await all.json()).examples.length > 0);
  const one = await realFetch(`${base}/playground/library/insecure-basic`);
  assert.equal(one.status, 200);
  const missing = await realFetch(`${base}/playground/library/nope`);
  assert.equal(missing.status, 404);
});
