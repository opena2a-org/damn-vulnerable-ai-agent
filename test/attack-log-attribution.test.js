/**
 * Regression test for issue #58: attack-log response attribution race.
 *
 * The deterministic RAG/research/flight paths logAttack() and then await
 * (renderResearchNarration, executeSubmitToIndex) before returning their reply.
 * Under concurrent requests to the *same* agent, a sibling request could log
 * during that await window and become the list head, so attaching the reply to
 * attackLog[0] mis-attributed it to the sibling's entry.
 *
 * These tests drive the *real* attribution primitives that src/index.js uses in
 * logAttack() (recordAttackEntry), the generateResponse() wrapper
 * (runWithAttribution), and its reply-attach step (attributeResponse). The
 * scoped work logs *after* an await, mirroring the log-then-await shape of the
 * real research/RAG paths, so the tests actually exercise context propagation
 * across the await -- the mechanism the fix depends on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordAttackEntry,
  runWithAttribution,
  attributeResponse,
} from '../src/attack-log-attribution.js';

const MAX_RESPONSE_LEN = 8000; // mirrors src/index.js
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Stand-in for the attack log + the core of logAttack(): unshift a fresh entry
 * to the head (matching src/index.js) and record it into the active store via
 * the *real* recordAttackEntry the production logAttack() calls.
 */
function makeLog() {
  const attackLog = [];
  const logAttack = (id) => {
    const entry = { id, agentId: id.split('#')[0], response: null };
    attackLog.unshift(entry);
    recordAttackEntry(entry); // the exact call src/index.js logAttack() makes
    return entry;
  };
  return { attackLog, logAttack };
}

/**
 * One generateResponse invocation on a deterministic async path, driven through
 * the real runWithAttribution + attributeResponse. Crucially it logs *after* an
 * await, exactly like the research/RAG/flight paths (logAttack then await
 * renderResearchNarration/executeSubmitToIndex), so the store must survive the
 * await for attribution to work.
 */
async function respond(logAttack, id, buildResult = (x) => `reply-${x}`) {
  const { result, entry } = await runWithAttribution(async () => {
    await nextTick();       // maybeEnforce()/webFetch() await BEFORE logging
    logAttack(id);          // logAttack(...) records into the active store
    await nextTick();       // renderResearchNarration()/executeSubmitToIndex() await AFTER logging
    return buildResult(id); // the deterministic content this invocation returns
  });
  attributeResponse(entry, result, MAX_RESPONSE_LEN); // real attach step
  return entry;
}

test('#58: concurrent same-agent async paths attribute each reply to its own entry', async () => {
  const { attackLog, logAttack } = makeLog();

  // Interleave two same-agent invocations. Each logs after an await and then
  // awaits again before returning, so the list head churns across both awaits.
  const [entryA, entryB] = await Promise.all([
    respond(logAttack, 'agent#A'),
    respond(logAttack, 'agent#B'),
  ]);

  assert.equal(entryA.id, 'agent#A');
  assert.equal(entryA.response, 'reply-agent#A', 'A must not receive B\'s reply');
  assert.equal(entryB.id, 'agent#B');
  assert.equal(entryB.response, 'reply-agent#B', 'B must not receive A\'s reply');

  // Every buffer entry is attributed to its own reply, none crossed or dropped.
  const pairs = attackLog.map((e) => [e.id, e.response]).sort();
  assert.deepEqual(pairs, [['agent#A', 'reply-agent#A'], ['agent#B', 'reply-agent#B']]);
});

test('#58: attribution survives an await placed AFTER the log (cross-await propagation)', async () => {
  // The property MEDIUM-flagged as untested: the deterministic paths log and
  // THEN await before returning. recordAttackEntry runs inside the awaited
  // continuation, so runWithAttribution's store must still be active there.
  const { logAttack } = makeLog();
  let capturedDuringAwait = null;

  const { entry } = await runWithAttribution(async () => {
    await nextTick();
    const e = logAttack('agent#solo');
    await nextTick();                 // store must survive THIS await
    capturedDuringAwait = e;          // and the entry recorded before it
    return 'reply-agent#solo';
  });

  assert.ok(entry, 'store.entry must be set from a log that happened between two awaits');
  assert.equal(entry, capturedDuringAwait, 'the recorded entry is this invocation\'s entry');
});

test('#58: the old attackLog[0] head-read approach mis-attributes under the same interleaving', async () => {
  // Demonstrates the bug the fix removes: attaching to the list head after the
  // await crosses the two replies. Proves the interleaving above is a real
  // reproduction of the race, not a no-op ordering.
  const attackLog = [];
  const logHead = (id) => { const e = { id, response: null }; attackLog.unshift(e); return e; };

  async function respondViaHead(id) {
    await nextTick();
    logHead(id);
    await nextTick();
    const head = attackLog[0];               // the racy read the fix replaced
    if (head && head.response == null) head.response = `reply-${id}`;
  }

  await Promise.all([respondViaHead('A'), respondViaHead('B')]);

  const byId = Object.fromEntries(attackLog.map((e) => [e.id, e.response]));
  const cleanlyAttributed = byId.A === 'reply-A' && byId.B === 'reply-B';
  assert.equal(cleanlyAttributed, false, 'head-read is expected to mis-attribute here');
});

test('attributeResponse handles string, {content}, and unattributable results', () => {
  // The two shapes generateResponse returns, plus the guards.
  const s = { response: null };
  attributeResponse(s, 'hello', MAX_RESPONSE_LEN);
  assert.equal(s.response, 'hello');

  const o = { response: null };
  attributeResponse(o, { content: 'narration', toolCalls: [] }, MAX_RESPONSE_LEN);
  assert.equal(o.response, 'narration');

  const already = { response: 'kept' };
  attributeResponse(already, 'overwrite', MAX_RESPONSE_LEN);
  assert.equal(already.response, 'kept', 'must not overwrite an already-attributed entry');

  const nonText = { response: null };
  attributeResponse(nonText, { toolCalls: [] }, MAX_RESPONSE_LEN); // no string content
  assert.equal(nonText.response, null, 'nothing to attribute -> left null');

  attributeResponse(null, 'x', MAX_RESPONSE_LEN); // no entry -> no throw
  const capped = { response: null };
  attributeResponse(capped, 'x'.repeat(10000), 8000);
  assert.equal(capped.response.length, 8000, 'response is truncated to maxLen');
});

test('recordAttackEntry outside a runWithAttribution scope is a no-op (a2a/mcp handlers)', async () => {
  // Calls made outside generateResponse() (the a2a/mcp handlers, which attribute
  // inline) must not throw and must not attach to any store.
  assert.doesNotThrow(() => recordAttackEntry({ id: 'x', response: null }));

  const { logAttack } = makeLog();
  const entry = await respond(logAttack, 'agent#solo2');
  assert.equal(entry.response, 'reply-agent#solo2');
});
