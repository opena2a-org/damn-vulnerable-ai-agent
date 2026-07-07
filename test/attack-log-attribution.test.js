/**
 * Regression test for issue #58: attack-log response attribution race.
 *
 * The deterministic RAG/research/flight paths logAttack() and then await
 * (renderResearchNarration, executeSubmitToIndex) before returning their reply.
 * Under concurrent requests to the *same* agent, a sibling request could log
 * during that await window and become the list head, so attaching the reply to
 * attackLog[0] mis-attributed it to the sibling's entry.
 *
 * These tests drive the real attribution primitives used by generateResponse()
 * and logAttack() in src/index.js, interleaving two invocations that reproduce
 * the log-then-await shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAttackEntry, runWithAttribution } from '../src/attack-log-attribution.js';

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A minimal stand-in for the attack log + logAttack: unshift a fresh entry to
 * the head (matching src/index.js) and record it for the enclosing invocation.
 */
function makeLog() {
  const attackLog = [];
  const logAttack = (id) => {
    const entry = { id, response: null };
    attackLog.unshift(entry);
    recordAttackEntry(entry);
    return entry;
  };
  return { attackLog, logAttack };
}

/**
 * One generateResponse invocation on a deterministic async path: log the
 * attack, await a narration step, then attach the computed reply to *this
 * invocation's* entry via runWithAttribution.
 */
async function respondViaAttribution(logAttack, id) {
  const { result, entry } = await runWithAttribution(async () => {
    logAttack(id);        // logAttack(...) records into the active store
    await nextTick();      // renderResearchNarration()/executeSubmitToIndex() await window
    return `reply-${id}`;  // the deterministic content this invocation returns
  });
  if (entry && entry.response == null) entry.response = result;
  return entry;
}

test('#58: concurrent same-agent async paths attribute each reply to its own entry', async () => {
  const { attackLog, logAttack } = makeLog();

  // Interleave: A logs (head=A), yields; B logs (head=B), yields; A resumes and
  // must attach reply-A to entry A even though the list head is now B.
  const [entryA, entryB] = await Promise.all([
    respondViaAttribution(logAttack, 'A'),
    respondViaAttribution(logAttack, 'B'),
  ]);

  assert.equal(entryA.id, 'A');
  assert.equal(entryA.response, 'reply-A', 'A must not receive B\'s reply');
  assert.equal(entryB.id, 'B');
  assert.equal(entryB.response, 'reply-B', 'B must not receive A\'s reply');

  // Every buffer entry is attributed to its own reply, none crossed or dropped.
  const pairs = attackLog.map((e) => [e.id, e.response]).sort();
  assert.deepEqual(pairs, [['A', 'reply-A'], ['B', 'reply-B']]);
});

test('#58: the old attackLog[0] head-read approach mis-attributes under the same interleaving', async () => {
  // Demonstrates the bug the fix removes: attaching to the list head after the
  // await crosses the two replies. This proves the interleaving above is a real
  // reproduction of the race, not a no-op ordering.
  const attackLog = [];
  const logHead = (id) => { const e = { id, response: null }; attackLog.unshift(e); return e; };

  async function respondViaHead(id) {
    logHead(id);
    await nextTick();
    const head = attackLog[0];               // the racy read the fix replaced
    if (head && head.response == null) head.response = `reply-${id}`;
  }

  await Promise.all([respondViaHead('A'), respondViaHead('B')]);

  const byId = Object.fromEntries(attackLog.map((e) => [e.id, e.response]));
  // Under this interleaving the head read gives at least one entry the wrong
  // reply (or leaves one unattributed). Assert it is NOT cleanly attributed,
  // which is exactly what the AsyncLocalStorage fix corrects.
  const cleanlyAttributed = byId.A === 'reply-A' && byId.B === 'reply-B';
  assert.equal(cleanlyAttributed, false, 'head-read is expected to mis-attribute here');
});

test('recordAttackEntry outside a runWithAttribution scope is a no-op (a2a/mcp handlers)', async () => {
  // Calls made outside generateResponse() (the a2a/mcp handlers, which attribute
  // inline) must not throw and must not attach to any store.
  assert.doesNotThrow(() => recordAttackEntry({ id: 'x', response: null }));

  // A subsequent scoped invocation still attributes correctly afterward.
  const { logAttack } = makeLog();
  const entry = await respondViaAttribution(logAttack, 'solo');
  assert.equal(entry.response, 'reply-solo');
});
