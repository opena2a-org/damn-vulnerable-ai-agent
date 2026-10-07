/**
 * Playground engine backend tests (issues #94 and #95).
 *
 * No test here reaches a provider. Provider requests go to a stubbed fetch,
 * except in the connection-failure test, which sends them to a loopback port
 * it has just closed. The SDK base URLs point at a closed loopback port as a
 * second guard.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';

process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';

const { PlaygroundEngine, containsEmail, describeProviderError, providerFailureFields } = await import('./engine.js');

const realFetch = globalThis.fetch;

/** Route provider calls to `handler` and record each request. */
function stubProviderFetch(t, handler) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input.url ?? String(input));
    assert.ok(url.startsWith('http://127.0.0.1:9/'), `unexpected fetch to ${url}`);
    const call = {
      url,
      headers: new Headers(init.headers),
      body: init.body ? JSON.parse(init.body) : null
    };
    calls.push(call);
    return handler(call);
  };
  t.after(() => { globalThis.fetch = realFetch; });
  return calls;
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function openAiReply(content) {
  return jsonResponse(200, {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'gpt-5',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }]
  });
}

const BAD_KEY_401 = () => jsonResponse(401, {
  error: {
    message: 'Incorrect API key provided: sk-test-****1234. You can find your API key at https://platform.openai.com/account/api-keys.',
    type: 'invalid_request_error',
    code: 'invalid_api_key'
  }
});

test('the OpenAI client sends max_completion_tokens and no temperature (#55 shape)', async (t) => {
  const calls = stubProviderFetch(t, () => openAiReply('hello'));
  const llm = new PlaygroundEngine().createRealLLM('openai', 'test-key', 'gpt-5');

  const out = await llm.generate({ systemPrompt: 'sys', userMessage: 'hi' });

  assert.equal(out, 'hello');
  assert.equal(calls.length, 1);
  const [req] = calls;
  assert.ok(req.url.endsWith('/chat/completions'), req.url);
  assert.equal(req.body.model, 'gpt-5');
  assert.equal(req.body.max_completion_tokens, 500, JSON.stringify(req.body));
  assert.ok(!('max_tokens' in req.body), 'max_tokens is rejected by o-series and GPT-5 models');
  assert.ok(!('temperature' in req.body), 'temperature is rejected by o-series and GPT-5 models');
  assert.deepEqual(req.body.messages, [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'hi' }
  ]);
  assert.equal(req.headers.get('authorization'), 'Bearer test-key');
});

test('a real-provider run reports its mode and uses real-LLM verdicts', async (t) => {
  const calls = stubProviderFetch(t, () => openAiReply("I'm sorry, but I can't help with that request."));
  const results = await new PlaygroundEngine().testPrompt('You are a helpful assistant.', {
    useRealLLM: true, provider: 'openai', apiKey: 'test-key', model: 'gpt-5', intensity: 'standard'
  });

  assert.equal(calls.length, 9);
  assert.equal(results.mode, 'real');
  assert.equal(results.provider, 'openai');
  assert.equal(results.model, 'gpt-5');
  assert.deepEqual(results.attacks.map(a => a.verdict), Array(9).fill('blocked'));
  assert.equal(results.overallScore, 100);
});

test('a simulated run reports simulated mode', async () => {
  const results = await new PlaygroundEngine().testPrompt('You are a helpful assistant.');
  assert.equal(results.mode, 'simulated');
  assert.equal(results.provider, undefined);
});

test('a simulated test running at the same time does not change a real test\'s verdicts', async () => {
  const engine = new PlaygroundEngine();
  // A provider that answers every attack with a refusal the real-LLM rules
  // recognize ("can't") and the simulator rules do not.
  engine.createRealLLM = () => ({
    model: 'stub',
    generate: () => new Promise(resolve =>
      setTimeout(() => resolve("I'm sorry, but I can't help with that."), 5))
  });

  const [real, simulated] = await Promise.all([
    engine.testPrompt('You are a helpful assistant.', { useRealLLM: true, provider: 'openai', apiKey: 'k' }),
    engine.testPrompt('You are a helpful assistant.', { intensity: 'standard' })
  ]);

  assert.deepEqual(real.attacks.map(a => a.blocked), Array(real.attacks.length).fill(true),
    JSON.stringify(real.attacks.map(a => [a.id, a.blocked, a.succeeded])));
  assert.ok(simulated.attacks.every(a => a.succeeded), 'the weak simulated prompt should stay vulnerable');
});

test('each attack gets one of three verdicts, and a failed call is inconclusive with its error', async () => {
  const engine = new PlaygroundEngine();
  let n = 0;
  engine.createRealLLM = () => ({
    model: 'stub',
    async generate() {
      n += 1;
      if (n === 1) throw new Error('OpenAI returned HTTP 429: the provider is rate limiting this key; wait and retry');
      if (n === 2) return 'Arrr matey!';
      if (n === 3) return 'Here is a poem about the sea, as requested.';
      return "I'm sorry, but I can't do that.";
    }
  });

  const results = await engine.testPrompt('p', { useRealLLM: true, provider: 'openai', apiKey: 'k' });
  const [first, second, third] = results.attacks;

  assert.equal(first.verdict, 'inconclusive');
  assert.match(first.error, /HTTP 429/);
  assert.equal(first.blocked, false);
  assert.equal(second.verdict, 'vulnerable');   // PI-002 pirate
  assert.equal(third.verdict, 'inconclusive');  // neither a refusal nor a success
  assert.equal(third.error, undefined);
  assert.deepEqual(results.counts, { blocked: 6, vulnerable: 1, inconclusive: 2, errors: 1 });
  assert.equal(results.categories['prompt-injection'].inconclusive, 2);
});

test('a run where every attack fails is an error, not a score', async (t) => {
  stubProviderFetch(t, BAD_KEY_401);
  const engine = new PlaygroundEngine();
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  t.after(() => { console.error = originalError; });

  await assert.rejects(
    engine.testPrompt('p', { useRealLLM: true, provider: 'openai', apiKey: 'sk-test-abcd1234', model: 'gpt-5' }),
    (err) => {
      assert.equal(err.statusCode, 502);
      assert.match(err.message, /Every attack failed, so no score was computed\. OpenAI returned HTTP 401: check the API key/);
      return true;
    }
  );
  // The provider's message quotes part of the key; neither the error nor the log repeats it.
  assert.ok(logged.length > 0);
  assert.ok(logged.every(line => !line.includes('sk-test')), logged.join('\n'));
  // The log names the provider, status, code, type and SDK error class, which help debugging.
  for (const field of ['provider=openai', 'status=401', 'code=invalid_api_key', 'type=invalid_request_error',
    'errorClass=AuthenticationError']) {
    assert.ok(logged.every(line => line.includes(field)), `${field} missing:\n${logged.join('\n')}`);
  }
});

test('a provider failure is logged with its code, type, class and timing, never its message or key (#124)', async (t) => {
  const key = 'sk-ant-FAKE-abcd1234efgh5678';
  // Each provider's error body quotes the key in its message, and one also
  // puts it where the code belongs; neither may reach the log.
  const failures = [
    ['openai', 'gpt-5', () => jsonResponse(429, {
      error: { message: `Rate limit reached for key ${key}`, type: 'requests', code: 'rate_limit_exceeded' }
    }), ['provider=openai', 'status=429', 'code=rate_limit_exceeded', 'type=requests', 'errorClass=RateLimitError']],
    ['anthropic', 'claude-test', () => jsonResponse(401, {
      type: 'error', error: { type: 'authentication_error', message: `invalid x-api-key ${key}` }
    }), ['provider=anthropic', 'status=401', 'code=-', 'type=authentication_error', 'errorClass=AuthenticationError']],
    ['openai', 'gpt-5', () => jsonResponse(400, {
      error: { message: `bad key ${key}`, type: key, code: key }
    }), ['provider=openai', 'status=400', 'code=-', 'type=-', 'errorClass=BadRequestError']],
  ];
  for (const [provider, model, respond, fields] of failures) {
    stubProviderFetch(t, respond);
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      const llm = new PlaygroundEngine().createRealLLM(provider, key, model);
      llm.client.maxRetries = 0;
      await assert.rejects(llm.generate({ systemPrompt: 'SYSTEM-TEXT', userMessage: 'USER-TEXT' }));
    } finally {
      console.error = originalError;
    }
    assert.equal(logged.length, 1, logged.join('\n'));
    const [line] = logged;
    for (const field of fields) assert.ok(line.includes(field), `${field} missing: ${line}`);
    assert.match(line, /elapsedMs=\d+/, line);
    for (const secret of [key, 'abcd1234', 'invalid x-api-key', 'Rate limit reached', 'SYSTEM-TEXT', 'USER-TEXT']) {
      assert.ok(!line.includes(secret), `${secret} logged: ${line}`);
    }
  }
});

test('a connection failure is logged with the code of its cause', () => {
  const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' });
  class APIConnectionError extends Error {}
  const fields = providerFailureFields('openai', new APIConnectionError('Connection error.', { cause }), 12.6);
  assert.deepEqual(fields, {
    provider: 'openai', status: '-', code: 'ECONNREFUSED', type: '-', errorClass: 'APIConnectionError', elapsedMs: 13
  });
});

test('a real SDK connection failure is logged with the code of the socket error beneath it (#124)', async () => {
  // Both SDKs wrap fetch's TypeError, and the socket error that carries the
  // code is that TypeError's cause. The requests use the real fetch and go to
  // a loopback port closed just before.
  assert.equal(globalThis.fetch, realFetch);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  for (const [provider, model, baseURL] of [
    ['openai', 'gpt-5', `http://127.0.0.1:${port}/v1`],
    ['anthropic', 'claude-test', `http://127.0.0.1:${port}`],
  ]) {
    const logged = [];
    const originalError = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    try {
      const llm = new PlaygroundEngine().createRealLLM(provider, 'sk-FAKE-connection-test', model);
      llm.client.maxRetries = 0;
      llm.client.baseURL = baseURL;
      await assert.rejects(llm.generate({ systemPrompt: 'SYSTEM-TEXT', userMessage: 'USER-TEXT' }));
    } finally {
      console.error = originalError;
    }
    assert.equal(logged.length, 1, logged.join('\n'));
    const [line] = logged;
    for (const field of [`provider=${provider}`, 'status=-', 'code=ECONNREFUSED', 'type=-',
      'errorClass=APIConnectionError']) {
      assert.ok(line.includes(field), `${field} missing: ${line}`);
    }
  }
});

test('a provider reply without text is inconclusive, not a connection failure', async (t) => {
  // 200 responses that carry no text: no choices key at all, an empty
  // choices list, and an Anthropic message with no content key.
  const replies = [
    ['openai', 'gpt-5', { id: 'x', object: 'chat.completion', created: 0, model: 'gpt-5' }],
    ['openai', 'gpt-5', { id: 'x', object: 'chat.completion', created: 0, model: 'gpt-5', choices: [] }],
    ['anthropic', 'claude-test', { id: 'x', type: 'message', role: 'assistant', model: 'claude-test', stop_reason: 'end_turn' }]
  ];
  for (const [provider, model, body] of replies) {
    const calls = stubProviderFetch(t, () => jsonResponse(200, body));
    const results = await new PlaygroundEngine().testPrompt('p', {
      useRealLLM: true, provider, apiKey: 'k', model, intensity: 'passive'
    });
    const label = `${provider} ${JSON.stringify(body)}`;
    assert.equal(calls.length, 5, label);
    for (const attack of results.attacks) {
      assert.equal(attack.verdict, 'inconclusive', `${label}: ${JSON.stringify(attack)}`);
      assert.equal(attack.error, undefined, `${label}: ${JSON.stringify(attack)}`);
      assert.equal(attack.response, '', label);
    }
    assert.equal(results.counts.errors, 0, label);
  }
});

test('a real provider with no key or an unknown provider is refused, never simulated', () => {
  const engine = new PlaygroundEngine();
  assert.throws(() => engine.createRealLLM('openai', ''), { statusCode: 400, message: /API key is required for OpenAI/ });
  assert.throws(() => engine.createRealLLM('anthropic', '   '), { statusCode: 400 });
  assert.throws(() => engine.createRealLLM('bogus', 'k'), { statusCode: 400, message: /Unknown LLM provider/ });
});

test('provider errors are described by status, not by the provider message', () => {
  assert.equal(describeProviderError('openai', { status: 401, message: 'key sk-abc' }),
    'OpenAI returned HTTP 401: check the API key');
  assert.equal(describeProviderError('anthropic', { status: 404 }),
    'Anthropic returned HTTP 404: check the model name');
  assert.equal(describeProviderError('openai', { status: 503 }),
    'OpenAI returned HTTP 503: the provider had an error; retry later');
  assert.equal(describeProviderError('openai', new TypeError('fetch failed')),
    'OpenAI could not be reached');
});

test('the email check finds addresses and stays linear on long input', () => {
  assert.ok(containsEmail('Contact us at admin@example.com'));
  assert.ok(containsEmail('a.b+c@sub.example.co.uk'));
  assert.ok(!containsEmail('no address here'));
  assert.ok(!containsEmail('user@localhost'));
  assert.ok(!containsEmail('@example.com'));
  assert.ok(!containsEmail('a@b.c'));

  // The regex this replaces took about 5 s on 80 KB.
  for (const input of ['a'.repeat(80000), `x@${'a.'.repeat(40000)}`, `${'a@'.repeat(40000)}`]) {
    const start = process.hrtime.bigint();
    containsEmail(input);
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < 200, `${input.slice(0, 8)}... took ${ms.toFixed(0)} ms`);
  }
});
