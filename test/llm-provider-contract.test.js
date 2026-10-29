/**
 * LLM provider request-contract tests.
 *
 * These pin the exact request body and headers DVAA sends to each provider's
 * HTTP API, with `fetch` monkey-patched so no network call happens. They are
 * deterministic and need no API key, so they run in CI on every push.
 *
 * Why this file exists (issue #55): the OpenAI Chat Completions request was
 * sending the deprecated `max_tokens`, which newer models (o-series / GPT-5.x)
 * reject with a 400. The only LLM tests we had mocked the *Anthropic* path and
 * never asserted the OpenAI body shape, so the drift shipped to a user before
 * we noticed. A provider's wire contract is exactly the kind of thing a unit
 * test should pin: when an upstream API renames or retires a field, this test
 * is where it must break first.
 *
 * NOTE: these guard against *regressions in what we send*. They cannot catch a
 * provider changing its API out from under us — only a real request can. That
 * live check lives in `scripts/smoke-llm.mjs` and release-smoke.md §4, which
 * issue a genuine call against a current model the way a user would.
 */

import { strict as assert } from 'assert';
import http from 'node:http';
import { createDashboardServer } from '../src/dashboard/server.js';
import { configureLLM, disableLLM, callLLM, verifyLLMConnection, DEFAULT_MODELS } from '../src/llm/provider.js';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

const originalFetch = globalThis.fetch;

/** Capture the single fetch DVAA makes and return a canned provider response. */
function mockFetch(response) {
  let captured = null;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return { ok: true, status: 200, json: async () => response };
  };
  return () => captured;
}

async function main() {
  console.log('LLM provider request-contract tests\n===================================\n');

  // -------------------------------------------------------------------
  // OpenAI Chat Completions
  // -------------------------------------------------------------------
  await test('OpenAI body uses max_completion_tokens, never deprecated max_tokens (issue #55)', async () => {
    configureLLM({ provider: 'openai', apiKey: 'test-key', model: 'gpt-5' });
    const get = mockFetch({ choices: [{ message: { content: 'hello' } }] });
    try {
      const out = await callLLM('sys', [{ role: 'user', content: 'hi' }], { maxTokens: 512 });
      const req = get();
      assert.equal(out, 'hello', 'completion text not returned');
      assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
      assert.equal(req.body.max_completion_tokens, 512, 'max_completion_tokens missing/incorrect');
      assert.ok(!('max_tokens' in req.body), 'deprecated max_tokens must NOT be present (breaks o-series/GPT-5)');
      assert.ok(!('temperature' in req.body), 'temperature must be omitted (o-series/GPT-5 reject non-default values)');
      assert.equal(req.body.model, 'gpt-5', 'model not forwarded');
      assert.ok(Array.isArray(req.body.messages), 'messages must be an array');
      assert.equal(req.body.messages[0].role, 'system', 'system prompt must be first message');
      assert.equal(req.init.headers.Authorization, 'Bearer test-key', 'auth header wrong');
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });

  await test('OpenAI body shape is identical for an older model (flat swap is safe everywhere)', async () => {
    configureLLM({ provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini' });
    const get = mockFetch({ choices: [{ message: { content: 'ok' } }] });
    try {
      await callLLM('sys', [{ role: 'user', content: 'hi' }], { maxTokens: 256 });
      const req = get();
      assert.equal(req.body.max_completion_tokens, 256, 'older model must also use max_completion_tokens');
      assert.ok(!('max_tokens' in req.body), 'no max_tokens for older model either');
      assert.ok(!('temperature' in req.body), 'temperature omitted for OpenAI across all models');
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });


  // -------------------------------------------------------------------
  // OpenRouter Chat Completions
  // -------------------------------------------------------------------
  await test('OpenRouter sends the correct URL, attribution headers and body', async () => {
    configureLLM({
      provider: 'openrouter',
      apiKey: 'openrouter-test-key',
      model: 'openai/gpt-oss-20b'
    });

    const get = mockFetch({
      choices: [{ message: { content: 'OpenRouter works' } }]
    });

    try {
      const out = await callLLM(
        'sys',
        [{ role: 'user', content: 'hi' }],
        { maxTokens: 256 }
      );

      const req = get();

      assert.equal(out, 'OpenRouter works');
      assert.equal(
        req.url,
        'https://openrouter.ai/api/v1/chat/completions'
      );
      assert.equal(
        req.init.headers.Authorization,
        'Bearer openrouter-test-key'
      );
      assert.equal(
        req.init.headers['HTTP-Referer'],
        'https://github.com/opena2a-org/damn-vulnerable-ai-agent'
      );
      assert.equal(
        req.init.headers['X-Title'],
        'Damn Vulnerable AI Agent'
      );

      assert.equal(req.body.model, 'openai/gpt-oss-20b');
      assert.equal(req.body.max_completion_tokens, 256);
      assert.ok(!('max_tokens' in req.body));
      assert.ok(!('temperature' in req.body));
      assert.equal(req.body.messages[0].role, 'system');
      assert.equal(req.body.messages[0].content, 'sys');
      assert.equal(req.body.messages[1].role, 'user');
      assert.equal(req.body.messages[1].content, 'hi');
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });


  await test('Connection verification accepts successful HTTP response with empty content', async () => {
    const get = mockFetch({
      choices: [{ message: { content: '' } }]
    });

    try {
      const result = await verifyLLMConnection({
        provider: 'openrouter',
        apiKey: 'openrouter-test-key',
        model: 'openai/gpt-oss-20b'
      });

      assert.equal(result.provider, 'openrouter');
      assert.equal(result.model, 'openai/gpt-oss-20b');

      const req = get();
      assert.equal(
        req.url,
        'https://openrouter.ai/api/v1/chat/completions'
      );
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });

  await test('connection verification does not disrupt active LLM calls', async () => {
    let markVerificationStarted;
    let releaseVerification;
    const verificationStarted = new Promise(resolve => {
      markVerificationStarted = resolve;
    });
    const verificationGate = new Promise(resolve => {
      releaseVerification = resolve;
    });

    configureLLM({ provider: 'openai', apiKey: 'active-key', model: 'gpt-5' });
    globalThis.fetch = async (url, init) => {
      if (init.headers.Authorization === 'Bearer verification-key') {
        markVerificationStarted();
        await verificationGate;
        return {
          ok: true,
          status: 200,
          json: async () => ({ choices: [{ message: { content: '' } }] })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'active call' } }] })
      };
    };

    try {
      const verification = verifyLLMConnection({
        provider: 'openrouter',
        apiKey: 'verification-key',
        model: DEFAULT_MODELS.openrouter
      });
      await verificationStarted;

      const result = await callLLM('sys', [{ role: 'user', content: 'hi' }]);
      assert.equal(result, 'active call');
      releaseVerification();
      await verification;
    } finally {
      releaseVerification();
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });

  await test('provider defaults are shared by verification and configuration', async () => {
    const get = mockFetch({ choices: [{ message: { content: '' } }] });

    try {
      const verification = await verifyLLMConnection({
        provider: 'openrouter',
        apiKey: 'openrouter-test-key'
      });
      const configured = configureLLM({
        provider: 'openrouter',
        apiKey: 'openrouter-test-key'
      });

      assert.equal(verification.model, DEFAULT_MODELS.openrouter);
      assert.equal(configured.model, DEFAULT_MODELS.openrouter);
      assert.equal(get().body.model, DEFAULT_MODELS.openrouter);
      assert.equal(DEFAULT_MODELS.openrouter, 'openai/gpt-oss-20b');
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });


  // -------------------------------------------------------------------
  // NVIDIA NIM Chat Completions
  // -------------------------------------------------------------------
  await test('NVIDIA NIM sends the correct URL, authorization and body', async () => {
    configureLLM({
      provider: 'nvidia',
      apiKey: 'nvidia-test-key',
      model: 'nvidia/nemotron-3.5-lightning-30b-a3b'
    });

    const get = mockFetch({
      choices: [{ message: { content: 'NVIDIA works' } }]
    });

    try {
      const out = await callLLM(
        'sys',
        [{ role: 'user', content: 'hi' }],
        { maxTokens: 256 }
      );

      const req = get();

      assert.equal(out, 'NVIDIA works');
      assert.equal(
        req.url,
        'https://integrate.api.nvidia.com/v1/chat/completions'
      );
      assert.equal(
        req.init.headers.Authorization,
        'Bearer nvidia-test-key'
      );
      assert.equal(req.init.headers['Content-Type'], 'application/json');

      assert.equal(
        req.body.model,
        'nvidia/nemotron-3.5-lightning-30b-a3b'
      );
      assert.equal(req.body.max_completion_tokens, 256);
      assert.ok(!('max_tokens' in req.body));
      assert.ok(!('temperature' in req.body));
      assert.equal(req.body.messages[0].role, 'system');
      assert.equal(req.body.messages[1].role, 'user');

      assert.ok(
        !('HTTP-Referer' in req.init.headers),
        'OpenRouter attribution header should not be sent to NVIDIA'
      );
      assert.ok(
        !('X-Title' in req.init.headers),
        'OpenRouter title header should not be sent to NVIDIA'
      );
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });


  // -------------------------------------------------------------------
  // Anthropic Messages
  // -------------------------------------------------------------------
  await test('Anthropic body uses max_tokens + system + version header', async () => {
    configureLLM({ provider: 'anthropic', apiKey: 'a-key', model: 'claude-sonnet-4-6' });
    const get = mockFetch({ content: [{ text: 'hi there' }] });
    try {
      const out = await callLLM('sys-prompt', [{ role: 'user', content: 'hi' }], { maxTokens: 333 });
      const req = get();
      assert.equal(out, 'hi there', 'completion text not returned');
      assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
      // Anthropic's Messages API DOES use max_tokens — do not "flat swap" it too.
      assert.equal(req.body.max_tokens, 333, 'Anthropic still requires max_tokens');
      assert.ok(!('max_completion_tokens' in req.body), 'Anthropic must not get the OpenAI field');
      // Anthropic accepts an explicit temperature — only OpenAI omits it.
      assert.ok('temperature' in req.body, 'Anthropic body should still carry temperature');
      assert.equal(req.body.system, 'sys-prompt', 'system prompt must be a top-level field, not a message');
      assert.equal(req.init.headers['x-api-key'], 'a-key', 'x-api-key header wrong');
      assert.ok(req.init.headers['anthropic-version'], 'anthropic-version header missing');
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });

  await test('/api/llm/configure returns an error status when verification fails', async () => {
    const server = createDashboardServer({
      stats: { startedAt: Date.now(), totalRequests: 0, attacksDetected: 0, attacksSuccessful: 0, byAgent: {}, byCategory: {} },
      attackLog: [],
      challengeState: {},
      agents: [],
      logAttack: () => {},
      sandbox: null,
      teamName: 'llm-provider-contract-test',
      timerMinutes: 0,
      track: () => {}
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized'
    });

    try {
      const payload = JSON.stringify({
        provider: 'openrouter',
        apiKey: 'invalid-key',
        model: DEFAULT_MODELS.openrouter
      });
      const response = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: server.address().port,
          path: '/api/llm/configure',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          },
          agent: false
        }, res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', reject);
        req.end(payload);
      });

      assert.equal(response.status, 400);
      assert.match(JSON.parse(response.body).error, /connection failed/i);
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

(async () => {
  await main();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
