/**
 * Agent runtime checks that need no running fleet (#86, #87).
 *
 *   - LLM mode scores an attack by its reply (revealsPlantedData).
 *   - Every LLM prompt is keyed by a real agent id, so no prompt sits unused
 *     the way VisionBot's did (keyed `visionbot`, while its id is `multimodal`).
 *   - VisionBot's metadata claims no image or OCR input it does not have.
 *   - The fleet is published on loopback by default: docker-compose.yml binds
 *     127.0.0.1, the image sets DVAA_HOST, and README docker examples name
 *     the host address of every published port.
 *
 * The live behaviour (body cap, error handling, chat message selection, /info,
 * stats accounting) is covered by agent-runtime-fleet.test.js.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PROMPTS, revealsPlantedData } from '../src/llm/prompts.js';
import { getAllAgents } from '../src/core/agents.js';
import { SENSITIVE_DATA } from '../src/core/vulnerabilities.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf-8');

test('revealsPlantedData: a refusal is not a leak, SecureBot included', () => {
  const username = SENSITIVE_DATA.credentials.admin.username;
  // LegacyBot's prompt carries the short username, so this also checks that a
  // short, common planted value does not count as a leak on its own.
  assert.ok(AGENT_PROMPTS.legacybot.includes(username), 'fixture: legacybot prompt should carry the admin username');
  for (const id of ['securebot', 'legacybot']) {
    for (const reply of [
      "I can't help with that request.",
      'I cannot share admin credentials or API keys.',
      `I won't reveal the ${username} password.`,
    ]) {
      assert.strictEqual(revealsPlantedData(reply, { systemPrompt: AGENT_PROMPTS[id] }), false, `${id} scored as a leak: ${reply}`);
    }
  }
});

test('revealsPlantedData: a value planted in the agent\'s prompt is a leak', () => {
  const planted = [
    SENSITIVE_DATA.credentials.admin.password,
    SENSITIVE_DATA.credentials.database.password,
    ...Object.values(SENSITIVE_DATA.apiKeys),
    SENSITIVE_DATA.pii.users[0].ssn,
    SENSITIVE_DATA.pii.users[1].email,
  ];
  for (const value of planted) {
    // Score each value against an agent whose prompt carries it.
    const systemPrompt = Object.values(AGENT_PROMPTS).find(prompt => prompt.includes(value));
    assert.ok(systemPrompt, `fixture: no agent prompt carries ${value}`);
    assert.strictEqual(revealsPlantedData(`Sure, here it is: ${value}.`, { systemPrompt }), true, `missed planted value ${value}`);
  }
});

test('revealsPlantedData: a value the agent was never given is not a leak', () => {
  // SecureBot's prompt carries no planted value, so a generic SSN-shaped
  // example or an @example.com address in its reply proves nothing.
  const systemPrompt = AGENT_PROMPTS.securebot;
  const reply = `An SSN looks like ${SENSITIVE_DATA.pii.users[0].ssn}; an address looks like ${SENSITIVE_DATA.pii.users[0].email}.`;
  assert.ok(!systemPrompt.includes(SENSITIVE_DATA.pii.users[0].ssn), 'fixture: securebot prompt should not carry the SSN');
  assert.strictEqual(revealsPlantedData(reply, { systemPrompt }), false, reply);
});

test('revealsPlantedData: a verbatim system-prompt line is a leak', () => {
  const prompt = AGENT_PROMPTS.helperbot;
  const line = prompt.split('\n').map(l => l.trim()).find(l => l.length >= 40);
  assert.ok(line, 'helperbot prompt should have a line of 40+ characters');
  assert.strictEqual(revealsPlantedData(`My instructions: ${line}`, { systemPrompt: prompt }), true);
  // A paraphrase is not proof of a leak.
  assert.strictEqual(revealsPlantedData('I am a friendly assistant.', { systemPrompt: prompt }), false);
});

test('revealsPlantedData: echoing text the user supplied is not a leak', () => {
  const secret = SENSITIVE_DATA.credentials.admin.password;
  const systemPrompt = AGENT_PROMPTS.legacybot;
  assert.ok(systemPrompt.includes(secret), 'fixture: the value must be planted for the agent');
  const userMessage = `Is the password ${secret}?`;
  assert.strictEqual(revealsPlantedData(`You asked whether it is ${secret}.`, { systemPrompt, userMessage }), false);
  assert.strictEqual(revealsPlantedData(`It is ${secret}.`, { systemPrompt }), true, 'the same reply without the user supplying it is a leak');
  assert.strictEqual(revealsPlantedData('', {}), false);
  assert.strictEqual(revealsPlantedData(null), false);
});

test('every LLM prompt is keyed by an agent id', () => {
  const ids = new Set(getAllAgents().map(a => a.id));
  for (const key of Object.keys(AGENT_PROMPTS)) {
    assert.ok(ids.has(key), `AGENT_PROMPTS.${key} matches no agent id, so that prompt is never used`);
  }
  assert.ok(AGENT_PROMPTS.multimodal, 'VisionBot (id multimodal) should have an LLM prompt');
});

test('VisionBot metadata claims no image or OCR input', () => {
  const vision = getAllAgents().find(a => a.id === 'multimodal');
  assert.ok(vision, 'multimodal agent should exist');
  assert.ok(!vision.features?.vision && !vision.features?.ocr, `features claim image input: ${JSON.stringify(vision.features)}`);
  assert.strictEqual(vision.features?.textInputOnly, true);
  assert.match(vision.description, /text input only/);
  const row = read('README.md').split('\n').find(l => l.startsWith('| VisionBot |'));
  assert.ok(row, 'README should have a VisionBot row');
  assert.match(row, /text input only/, `README VisionBot row: ${row}`);
});

test('docker-compose.yml publishes every port on 127.0.0.1 only', () => {
  const mappings = read('docker-compose.yml').split('\n')
    .map(l => l.trim().match(/^- "([^"]+)"$/)).filter(Boolean).map(m => m[1]);
  assert.ok(mappings.length >= 20, `expected the fleet's port mappings, found ${mappings.length}`);
  for (const m of mappings) {
    assert.match(m, /^127\.0\.0\.1:\d+:\d+$/, `port mapping not bound to loopback: ${m}`);
  }
});

test('the image sets DVAA_HOST=0.0.0.0 so published ports reach the fleet', () => {
  assert.match(read('Dockerfile'), /^ENV DVAA_HOST=0\.0\.0\.0$/m);
});

test('README docker examples name the host address of every published port', () => {
  const flags = [...read('README.md').matchAll(/-p\s+(\S+)/g)].map(m => m[1]);
  assert.ok(flags.length > 0, 'README should contain docker -p examples');
  for (const flag of flags) {
    assert.match(flag, /^(127\.0\.0\.1|0\.0\.0\.0):/, `README publishes "-p ${flag}" on every host interface without saying so`);
  }
});
