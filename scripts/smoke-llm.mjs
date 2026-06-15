#!/usr/bin/env node
/**
 * Live LLM smoke — exercises the real provider path the way a user does.
 *
 *   node scripts/smoke-llm.mjs
 *
 * For each provider whose API key is present in the environment, this makes a
 * GENUINE request through the same `callLLM` code path the dashboard and CLI
 * use, against a CURRENT production model, and asserts a non-empty completion
 * comes back. No mocks. This is the only check that catches a provider changing
 * its API out from under us — e.g. issue #55, where newer OpenAI models began
 * rejecting `max_tokens`. A mocked unit test pins what we *send*; this pins that
 * what we send still *works*.
 *
 * Crucially it defaults the OpenAI model to a NEWER model class (the one that
 * rejects `max_tokens`), not gpt-4o-mini — older models accept both params, so
 * smoking only an old model would have missed issue #55 entirely.
 *
 * Keys (set whichever you want to smoke; missing ones SKIP, never fail):
 *   OPENAI_API_KEY        + optional SMOKE_OPENAI_MODEL     (default: gpt-5)
 *   ANTHROPIC_API_KEY     + optional SMOKE_ANTHROPIC_MODEL  (default: claude-sonnet-4-6)
 *
 * Exit code: 0 if every provider with a key returned a completion (or was
 * skipped); 1 if any real call failed. Errors are printed by callLLM itself.
 */

import { configureLLM, callLLM, disableLLM } from '../src/llm/provider.js';

const CASES = [
  {
    provider: 'openai',
    apiKey: process.env.OPENAI_API_KEY,
    // Default to a newer model on purpose: it's the class that rejects max_tokens.
    model: process.env.SMOKE_OPENAI_MODEL || 'gpt-5',
    keyVar: 'OPENAI_API_KEY',
  },
  {
    provider: 'anthropic',
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.SMOKE_ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    keyVar: 'ANTHROPIC_API_KEY',
  },
];

const PROMPT = 'Reply with exactly the word: pong';

let failed = 0;
let ran = 0;

console.log('Live LLM smoke\n==============\n');

for (const c of CASES) {
  if (!c.apiKey) {
    console.log(`  SKIP  ${c.provider} (set ${c.keyVar} to smoke this provider)`);
    continue;
  }
  ran++;
  process.stdout.write(`  ....  ${c.provider} (${c.model}) ... `);
  configureLLM({ provider: c.provider, apiKey: c.apiKey, model: c.model });
  let reply = null;
  try {
    reply = await callLLM('You are a smoke test. Answer in one word.', [
      { role: 'user', content: PROMPT },
    ], { maxTokens: 32, temperature: 0 });
  } catch (err) {
    // callLLM normally swallows and returns null, but guard anyway.
    console.log(`FAIL (${err.message})`);
    failed++;
    disableLLM();
    continue;
  }
  disableLLM();

  if (reply && reply.trim().length > 0) {
    console.log(`PASS -> "${reply.trim().slice(0, 40)}"`);
  } else {
    // callLLM already printed the underlying "[LLM] Error: ..." line.
    console.log('FAIL (no completion returned — see [LLM] Error above)');
    failed++;
  }
}

if (ran === 0) {
  console.log('\nNo provider keys set — nothing smoked. Set OPENAI_API_KEY and/or');
  console.log('ANTHROPIC_API_KEY to exercise the real provider path before release.');
}

console.log(`\nResults: ${ran - failed}/${ran} live calls passed${failed ? ` (${failed} FAILED)` : ''}`);
process.exit(failed > 0 ? 1 : 0);
