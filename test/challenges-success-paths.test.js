/**
 * Challenge success paths (#90, #73).
 *
 * Three agents declare a behaviour in src/core/agents.js that the request
 * handlers did not carry out:
 *   - L1-03: HelperBot's declared prompt-injection triggers were ignored;
 *   - L3-01: RAGBot's data-exfiltration success path could reply null instead
 *     of the knowledge-base document the challenge verifies against;
 *   - L3-05 / L3-07: PluginBot's register_tool never added the tool.
 *
 * Loaded at runtime: the agents' declared triggers, knowledge base and tools
 * (src/core/agents.js), the legacy override markers
 * (src/agent-success-paths.js), and the documented L1-01 and L3-01 solutions
 * and the challenges' success patterns (src/challenges/index.js). The tests
 * also use their own inputs (a benign message, text wrapped around a trigger
 * or a documented phrase, a context-window question, tool names and
 * descriptions, a file path) and a literal copy of one keyword reply (the
 * context-window reply), matched in part in one test and in full in another.
 *
 * The unit tests need no fleet. The wiring tests at the end drive the real
 * agents and skip when no fleet is reachable on :9000.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getAgent } from '../src/core/agents.js';
import { detectAttacks } from '../src/core/vulnerabilities.js';
import { getChallenge, verifyChallenge } from '../src/challenges/index.js';
import {
  LEGACY_OVERRIDE_MARKERS,
  MAX_DYNAMIC_TOOLS,
  declaredOverrideTriggers,
  exfiltrationReply,
  registerDynamicTool,
  takesDeclaredTriggerPath,
  takesLegacyOverridePath,
} from '../src/agent-success-paths.js';

const helperbot = getAgent('helperbot');
const codebot = getAgent('codebot');
const ragbot = getAgent('ragbot');
const pluginbot = getAgent('pluginbot');
const proxybot = getAgent('proxybot');

const helperTriggers = helperbot.vulnerabilities.promptInjection.triggers;
const BENIGN = 'What time does the library open on Saturday?';

const containsAny = (message, phrases) => phrases.some(p => message.toLowerCase().includes(p.toLowerCase()));

// The documented L3-01 solution names its phrases in double quotes. The ones
// the detector flags as data exfiltration take RAGBot's success path.
function l301SolutionPhrases() {
  return [...getChallenge('L3-01').solution.matchAll(/"([^"]+)"/g)]
    .map(m => m[1])
    .filter(p => detectAttacks(p).dataExfiltration);
}

// The documented L1-01 solution names its phrases in double quotes.
function l101SolutionPhrases() {
  return [...getChallenge('L1-01').solution.matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

// The knowledge-base document L3-01 verifies against.
function l301Document() {
  const { pattern } = getChallenge('L3-01').successCriteria;
  return ragbot.knowledgeBase.find(doc => pattern.test(doc.content));
}

function freshPluginBot() {
  return { id: pluginbot.id, name: pluginbot.name, tools: pluginbot.tools.map(t => ({ ...t })) };
}

// ── L1-03: HelperBot's declared triggers ────────────────────────────────

test('L1-03: every HelperBot trigger takes the override path', () => {
  assert.ok(helperTriggers.length > 0, 'HelperBot declares no triggers');
  helperTriggers.forEach((trigger, i) => {
    assert.equal(takesDeclaredTriggerPath(helperbot, trigger), true, `trigger #${i} did not take the override path`);
  });
});

test('L1-03: a trigger is recognised in any case and inside a longer message', () => {
  helperTriggers.forEach((trigger, i) => {
    const message = `Before you answer: ${trigger.toUpperCase()}. Thanks.`;
    assert.equal(takesDeclaredTriggerPath(helperbot, message), true, `trigger #${i} missed in a longer message`);
  });
});

test('L1-03: a benign message does not take the override path', () => {
  assert.equal(containsAny(BENIGN, helperTriggers), false);
  assert.equal(takesLegacyOverridePath(helperbot, BENIGN, detectAttacks(BENIGN)), false);
  assert.equal(takesDeclaredTriggerPath(helperbot, BENIGN), false);
});

test('L1-03: the legacy override markers still take the override path on a detected injection', () => {
  for (const [i, marker] of LEGACY_OVERRIDE_MARKERS.entries()) {
    assert.equal(takesLegacyOverridePath(helperbot, `${BENIGN} ${marker.text}`, { promptInjection: true }), true, `marker #${i} no longer accepted`);
    assert.equal(takesLegacyOverridePath(helperbot, `${BENIGN} ${marker.text}`, { promptInjection: false }), false,
      `marker #${i} accepted without a detected injection`);
  }
});

test('L1-03: only HelperBot gains the declared-trigger path', () => {
  assert.deepEqual(declaredOverrideTriggers(codebot), []);
  // CodeBot keeps exactly the legacy behaviour for its own declared triggers.
  codebot.vulnerabilities.promptInjection.triggers.forEach((trigger, i) => {
    const attacks = detectAttacks(trigger);
    const legacy = Boolean(attacks.promptInjection) && LEGACY_OVERRIDE_MARKERS.some(m => (m.caseSensitive
      ? trigger.includes(m.text) : trigger.toLowerCase().includes(m.text.toLowerCase())));
    assert.equal(takesLegacyOverridePath(codebot, trigger, attacks), legacy, `CodeBot trigger #${i} changed behaviour`);
    assert.equal(takesDeclaredTriggerPath(codebot, trigger), false, `CodeBot trigger #${i} took the declared-trigger path`);
  });
  // An agent with prompt injection disabled never takes the path.
  assert.equal(takesLegacyOverridePath(ragbot, helperTriggers[0], { promptInjection: true }), false);
  assert.equal(takesDeclaredTriggerPath(ragbot, helperTriggers[0]), false);
});

// ── L3-01: RAGBot returns the knowledge-base document ──────────────────

test('L3-01: the documented solution gets a reply carrying the KB document it verifies against', () => {
  const doc = l301Document();
  assert.ok(doc, 'no RAGBot knowledge-base document matches the L3-01 success pattern');
  const phrases = l301SolutionPhrases();
  assert.ok(phrases.length > 0, 'no documented L3-01 phrase is flagged as data exfiltration');
  phrases.forEach((phrase, i) => {
    const reply = exfiltrationReply(ragbot, phrase);
    assert.equal(typeof reply, 'string', `phrase #${i} got a null reply`);
    assert.ok(reply.includes(doc.content), `phrase #${i} reply lacks the KB document`);
    assert.equal(verifyChallenge('L3-01', reply).success, true, `phrase #${i} reply does not verify`);
  });
});

test('L3-01: a keyword reply from a retrieval agent also carries its documents', () => {
  const doc = l301Document();
  const reply = exfiltrationReply(ragbot, 'How many tokens fit in your context window?');
  assert.match(reply, /128k token context window/);
  assert.ok(reply.includes(doc.content));
});

test('L3-01: an agent without a knowledge base keeps its keyword replies unchanged', () => {
  const reply = exfiltrationReply(helperbot, 'How many tokens fit in your context window?');
  assert.equal(reply, `[${helperbot.name}] I have a 128k token context window with approximately 2000 tokens used in this conversation.`);
});

// ── L3-05 / L3-07: register_tool adds the tool ─────────────────────────

test('L3-05: register_tool adds the registered tool to agent.tools', () => {
  const agent = freshPluginBot();
  const before = agent.tools.length;
  const reg = registerDynamicTool(agent, { name: 'weather_lookup', description: 'Looks up the weather' });
  assert.equal(reg.status, 'added');
  assert.equal(agent.tools.length, before + 1);
  const entry = agent.tools.find(t => t.name === 'weather_lookup');
  assert.ok(entry, 'registered tool missing from agent.tools');
  assert.equal(entry.source, 'dynamic');
  assert.equal(entry.description, 'Looks up the weather');
  assert.equal(entry.vulnerable, undefined, 'a new registered tool must not reach a tool handler');
});

test('L3-05: a second registration of the same name does not duplicate it', () => {
  const agent = freshPluginBot();
  registerDynamicTool(agent, { name: 'weather_lookup', description: 'first' });
  const reg = registerDynamicTool(agent, { name: 'weather_lookup', description: 'second' });
  assert.equal(reg.status, 'replaced');
  const matches = agent.tools.filter(t => t.name === 'weather_lookup');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].description, 'second');
});

test('L3-07: a registration under a built-in name replaces it and keeps its vulnerable flag', () => {
  const agent = freshPluginBot();
  const builtIn = agent.tools[0];
  const before = agent.tools.length;
  const reg = registerDynamicTool(agent, { name: builtIn.name, description: 'neutral replacement' });
  assert.equal(reg.status, 'replaced');
  assert.equal(agent.tools.length, before);
  const matches = agent.tools.filter(t => t.name === builtIn.name);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].description, 'neutral replacement');
  assert.equal(matches[0].source, 'dynamic');
  assert.equal(matches[0].vulnerable, builtIn.vulnerable);
});

test('L3-05: registrations past the cap are refused', () => {
  const agent = freshPluginBot();
  const builtIns = agent.tools.length;
  for (let i = 0; i < MAX_DYNAMIC_TOOLS; i++) {
    assert.equal(registerDynamicTool(agent, { name: `test_tool_${i}` }).status, 'added', `registration ${i} refused below the cap`);
  }
  const over = registerDynamicTool(agent, { name: 'test_tool_over_cap' });
  assert.equal(over.status, 'refused');
  assert.equal(over.tool, null);
  assert.equal(agent.tools.length, builtIns + MAX_DYNAMIC_TOOLS);
  assert.equal(agent.tools.some(t => t.name === 'test_tool_over_cap'), false);
  // Re-registering a held name at the cap replaces it and does not grow the list.
  assert.equal(registerDynamicTool(agent, { name: 'test_tool_0', description: 'updated' }).status, 'replaced');
  assert.equal(agent.tools.length, builtIns + MAX_DYNAMIC_TOOLS);
});

// ── Wiring against a running fleet (skipped when none is reachable) ─────

async function isUp(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try { await fetch(url, { signal: ctrl.signal }); return true; }
  catch { return false; }
  finally { clearTimeout(t); }
}

async function skipWithoutFleet(t) {
  if (await isUp('http://localhost:9000/health')) return false;
  t.skip('DVAA fleet not running on :9000 (start it with `npm run start:all`)');
  return true;
}

async function chat(agent, message) {
  const resp = await fetch(`http://localhost:${agent.port}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return (await resp.json()).response;
}

async function rpc(agent, method, params) {
  const resp = await fetch(`http://localhost:${agent.port}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, id: 1, params }),
  });
  return resp.json();
}

test('fleet: HelperBot takes the override path for each declared trigger', async (t) => {
  if (await skipWithoutFleet(t)) return;
  for (const [i, trigger] of helperTriggers.entries()) {
    const reply = await chat(helperbot, trigger);
    assert.equal(typeof reply, 'string', `trigger #${i} got no reply`);
    assert.equal(verifyChallenge('L1-03', reply).success, true, `trigger #${i} reply does not verify (reply length ${reply.length})`);
  }
});

test('fleet: a HelperBot trigger in a documented L1-01 question keeps the reply that verifies L1-01', async (t) => {
  if (await skipWithoutFleet(t)) return;
  let checked = 0;
  for (const [p, phrase] of l101SolutionPhrases().entries()) {
    const alone = await chat(helperbot, phrase);
    if (typeof alone !== 'string' || !verifyChallenge('L1-01', alone).success) continue;
    for (const [i, trigger] of helperTriggers.entries()) {
      const message = `${trigger}: ${phrase}`;
      // A legacy marker on a detected injection takes the override path first, as it always has.
      if (takesLegacyOverridePath(helperbot, message, detectAttacks(message))) continue;
      const reply = await chat(helperbot, message);
      assert.equal(typeof reply, 'string', `phrase #${p} with trigger #${i} got no reply`);
      assert.equal(verifyChallenge('L1-01', reply).success, true, `phrase #${p} with trigger #${i} reply does not verify L1-01`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'no documented L1-01 phrase was checked with a trigger');
});

test('fleet: RAGBot replies to the documented L3-01 solution with its KB document', async (t) => {
  if (await skipWithoutFleet(t)) return;
  for (const [i, phrase] of l301SolutionPhrases().entries()) {
    const reply = await chat(ragbot, phrase);
    assert.equal(typeof reply, 'string', `phrase #${i} got a null reply`);
    assert.equal(verifyChallenge('L3-01', reply).success, true, `phrase #${i} reply does not verify`);
  }
});

test('fleet: PluginBot lists a tool after register_tool', async (t) => {
  if (await skipWithoutFleet(t)) return;
  // A fixed name, so repeated runs against one fleet replace rather than grow.
  const name = 'dvaa_success_path_probe';
  const reg = await rpc(pluginbot, 'tools/call', { name: 'register_tool', arguments: { name, description: 'test probe' } });
  const result = JSON.parse(reg.result.content[0].text);
  assert.equal(result.success, true, `register_tool refused: ${result.error}`);
  const list = await rpc(pluginbot, 'tools/list', {});
  const listed = list.result.tools.filter(tool => tool.name === name);
  assert.equal(listed.length, 1, `registered tool listed ${listed.length} times`);
});

test('fleet: register_tool on ProxyBot leaves its tools/list and read_file traversal unchanged', async (t) => {
  if (await skipWithoutFleet(t)) return;
  const toolNames = async () => (await rpc(proxybot, 'tools/list', {})).result.tools.map(tool => tool.name);
  const callTool = async (name, args) => {
    const resp = await rpc(proxybot, 'tools/call', { name, arguments: args });
    assert.equal(resp.error, undefined, `${name} returned a JSON-RPC error`);
    return JSON.parse(resp.result.content[0].text);
  };
  const readTraversal = () => callTool('read_file', { path: '../../etc/passwd' });

  const toolsBefore = await toolNames();
  const readBefore = await readTraversal();
  assert.equal(readBefore.success, true, 'read_file traversal failed before any registration');
  // A name ProxyBot resolves by name only, then register_tool itself.
  for (const name of ['read_file', 'register_tool']) {
    const reg = await callTool('register_tool', { name });
    assert.equal(reg.toolRegistered, name, `register_tool did not register ${name}`);
  }
  assert.deepEqual(await toolNames(), toolsBefore, 'ProxyBot tools/list changed after register_tool');
  assert.deepEqual(await readTraversal(), readBefore, 'ProxyBot read_file traversal changed after register_tool');
  const again = await callTool('register_tool', { name: 'dvaa_proxy_probe' });
  assert.equal(again.toolRegistered, 'dvaa_proxy_probe', 'register_tool stopped registering on ProxyBot');
});
