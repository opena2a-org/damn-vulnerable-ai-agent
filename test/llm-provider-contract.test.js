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
import { configureLLM, disableLLM, callLLM } from '../src/llm/provider.js';

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
      assert.equal(req.body.system, 'sys-prompt', 'system prompt must be a top-level field, not a message');
      assert.equal(req.init.headers['x-api-key'], 'a-key', 'x-api-key header wrong');
      assert.ok(req.init.headers['anthropic-version'], 'anthropic-version header missing');
    } finally {
      globalThis.fetch = originalFetch;
      disableLLM();
    }
  });
}

(async () => {
  await main();
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})();
