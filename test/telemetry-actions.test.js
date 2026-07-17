import { test } from 'node:test';
import assert from 'node:assert';
import { actionFor, createActionTracker, USER_ACTIONS } from '../src/telemetry/actions.js';

/*
 * dvaa reported 177 monthly actives against 1 engaged user. Not churn —
 * structural: the docker CMD passes no subcommand, so the server path runs, and
 * the only tele.track call lived in the CLI dispatcher which that path never
 * reaches. Every docker install emitted one `start` on its boot day and nothing
 * else, so it could never satisfy `engaged` (>= 2 active days AND >= 1 command).
 *
 * These tests guard the fix and, more importantly, guard the two ways the fix
 * could turn into fabrication.
 */

test('the core lab actions are tracked', () => {
  assert.equal(actionFor('POST', '/api/agents/prompt-injection/chat'), 'lab-chat');
  assert.equal(actionFor('POST', '/api/challenges/ctf-01/verify'), 'lab-challenge-verify');
  assert.equal(actionFor('POST', '/api/scenarios/rag-poisoning/scan'), 'lab-scan');
  assert.equal(actionFor('POST', '/api/scenarios/rag-poisoning/fix'), 'lab-fix');
  assert.equal(actionFor('POST', '/api/tutor/ask'), 'lab-tutor-ask');
  assert.equal(actionFor('POST', '/api/llm/configure'), 'lab-llm-configure');
  assert.equal(actionFor('POST', '/api/reset'), 'lab-reset');
});

test('the HEALTHCHECK endpoints are NEVER tracked', () => {
  // The container polls /stats every 30s (Dockerfile:21-22). Tracking it would
  // mint a flawless engagement record for a lab nobody has ever opened — a
  // number that looks excellent and means nothing. This is the single most
  // important assertion in this file.
  assert.equal(actionFor('GET', '/stats'), null);
  assert.equal(actionFor('POST', '/stats'), null);
  assert.equal(actionFor('GET', '/health'), null);
  assert.equal(actionFor('POST', '/health'), null);
});

test('reads are never tracked — polling the UI is not a user action', () => {
  for (const p of [
    '/agents',
    '/api/tracks',
    '/api/scenarios',
    '/api/challenges',
    '/api/attack-log',
    '/api/scoreboard',
    '/api/timer',
    '/api/team',
    '/api/sandbox/files',
    '/api/sandbox/exfil-log',
    '/api/sandbox/cmd-log',
  ]) {
    assert.equal(actionFor('GET', p), null, `GET ${p} must not be tracked`);
  }
});

test('the same path under a different method is not tracked', () => {
  assert.equal(actionFor('GET', '/api/agents/x/chat'), null);
  assert.equal(actionFor('DELETE', '/api/reset'), null);
});

test('every allowlist entry is a POST with a stable, content-free name', () => {
  // Fails by construction if someone adds a GET or an id-bearing name.
  for (const a of USER_ACTIONS) {
    assert.equal(a.method, 'POST', `${a.name} must be a POST — reads are not actions`);
    assert.match(a.name, /^lab-[a-z-]+$/, `${a.name} must be a stable label`);
  }
});

test('near-miss paths do not match', () => {
  assert.equal(actionFor('POST', '/api/agents/chat'), null); // no id segment
  assert.equal(actionFor('POST', '/api/agents/a/b/chat'), null); // extra segment
  assert.equal(actionFor('POST', '/api/agents/x/chatty'), null);
  assert.equal(actionFor('POST', '/api/reset/all'), null);
  assert.equal(actionFor('POST', '/x/api/reset'), null);
});

test('bad input is not a match', () => {
  assert.equal(actionFor(undefined, '/api/reset'), null);
  assert.equal(actionFor('POST', undefined), null);
  assert.equal(actionFor(null, null), null);
});

test('a tracked action emits exactly one event', () => {
  const sent = [];
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => Date.parse('2026-07-16T10:00:00Z') });
  t('POST', '/api/agents/x/chat');
  assert.deepEqual(sent, ['lab-chat']);
});

test('an untracked request emits nothing', () => {
  const sent = [];
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => Date.parse('2026-07-16T10:00:00Z') });
  t('GET', '/stats');
  t('GET', '/health');
  t('GET', '/api/attack-log');
  assert.deepEqual(sent, []);
});

const at = (iso) => Date.parse(iso);

test('a burst of payloads is one engaged human, not a hundred events', () => {
  const sent = [];
  let clock = at('2026-07-16T10:00:00Z');
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => clock });
  for (let i = 0; i < 100; i++) {
    clock += 1000; // 100 requests over ~100 seconds
    t('POST', '/api/agents/x/chat');
  }
  assert.equal(sent.length, 1, 'one event per action per UTC day');
});

test('using the lab on two different days emits on each — this is what engaged measures', () => {
  const sent = [];
  let clock = at('2026-07-16T10:00:00Z');
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => clock });
  t('POST', '/api/agents/x/chat');
  clock = at('2026-07-17T10:00:00Z');
  t('POST', '/api/agents/x/chat');
  assert.equal(sent.length, 2);
});

test('a user active either side of UTC midnight reports BOTH days', () => {
  // Regression guard. A rolling one-hour throttle suppressed the second event
  // here, so a genuinely 2-day-active user reported one day and could never be
  // engaged — the throttle hiding exactly the users this exists to count.
  // `engaged` buckets by UTC day, so the throttle must too.
  const sent = [];
  let clock = at('2026-07-16T23:59:00Z');
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => clock });
  t('POST', '/api/agents/x/chat');
  clock = at('2026-07-17T00:30:00Z'); // 31 minutes later, but a different UTC day
  t('POST', '/api/agents/x/chat');
  assert.equal(sent.length, 2, 'a new UTC day must always emit, however close in wall-clock time');
});

test('two actions within the same UTC day but hours apart still emit once', () => {
  const sent = [];
  let clock = at('2026-07-16T00:05:00Z');
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => clock });
  t('POST', '/api/agents/x/chat');
  clock = at('2026-07-16T23:55:00Z'); // ~24h later, same UTC day
  t('POST', '/api/agents/x/chat');
  assert.equal(sent.length, 1, 'the same day is the same day, however far apart');
});

test('the throttle map is bounded by the allowlist, not by time', () => {
  // The day is the VALUE, not part of the key, so a long-lived container cannot
  // grow this without bound.
  const sent = [];
  let clock = at('2026-07-16T10:00:00Z');
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => clock });
  for (let d = 0; d < 400; d++) {
    clock += 24 * 60 * 60 * 1000;
    t('POST', '/api/agents/x/chat');
    t('POST', '/api/agents/other-agent/chat'); // same action name
  }
  assert.equal(sent.length, 400, 'one per day');
});

test('different actions have independent throttles', () => {
  const sent = [];
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => at('2026-07-16T10:00:00Z') });
  t('POST', '/api/agents/x/chat');
  t('POST', '/api/challenges/c/verify');
  assert.deepEqual(sent, ['lab-chat', 'lab-challenge-verify']);
});

test('telemetry never breaks the lab', () => {
  // A throwing or rejecting track must not surface on a request path.
  const throwing = createActionTracker({
    track: () => {
      throw new Error('registry down');
    },
    now: () => Date.parse('2026-07-16T10:00:00Z'),
  });
  assert.doesNotThrow(() => throwing('POST', '/api/agents/x/chat'));

  const rejecting = createActionTracker({ track: () => Promise.reject(new Error('nope')), now: () => 0 });
  assert.doesNotThrow(() => rejecting('POST', '/api/agents/x/chat'));
});

test('no content, ids or paths reach the event name', () => {
  const sent = [];
  const t = createActionTracker({ track: (n) => sent.push(n), now: () => Date.parse('2026-07-16T10:00:00Z') });
  t('POST', '/api/agents/super-secret-agent-name/chat');
  assert.deepEqual(sent, ['lab-chat']);
  assert.ok(!sent[0].includes('secret'));
});
