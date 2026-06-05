/**
 * Regression test for the DVAA behavioral-trust layer (src/aim-enforcer.js).
 *
 * aim-core's calculateTrust() scores configuration posture and is static. DVAA
 * adds a behavioral penalty: each `denied` out-of-scope attempt in the agent's
 * audit log lowers its current trust by a fixed amount, floored. The A/B demo
 * relies on this producing a visible, honest before -> after drop on Run B.
 *
 * These tests pin: (1) a denied action drops the score, (2) an allowed action
 * does not, (3) the score is floored and never collapses to zero.
 */

import test from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Point the enforcer at a throwaway data dir BEFORE first import/use so the
// module-cached AIMCore writes its identity + audit log there, not in-repo.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-aim-behavioral-'));
process.env.DVAA_AIM_DATA_DIR = tmp;
delete process.env.AIM_ENFORCEMENT;

const { maybeEnforce, readTrustScore } = await import('../src/aim-enforcer.js');

const agent = {
  id: 'test-ragbot-aim',
  aimEnforced: true,
  aimCapabilities: ['rag:read', 'chat:respond'],
};

const denyOnce = () => maybeEnforce(agent, {
  action: 'http:post',
  resource: 'http://127.0.0.1/canary',
  context: { tool: 'submit_to_index' },
});

test('a denied out-of-scope action drops behavioral trust (before > after)', async () => {
  const r = await denyOnce();
  assert.equal(r.denied, true, 'http:post is outside the grant');
  assert.ok(r.trustDelta, 'trustDelta is present on a denial');
  assert.equal(r.trustDelta.deniedCount, 1);
  assert.ok(
    r.trustDelta.before.score > r.trustDelta.after.score,
    'the score after the denial is lower than before',
  );
  assert.equal(
    r.trustDelta.before.score - r.trustDelta.after.score,
    r.trustDelta.penaltyPerDenial,
    'the drop equals exactly one denial penalty',
  );
  // trustScore (the single-value field) reflects the current, post-event score.
  assert.equal(r.trustScore.score, r.trustDelta.after.score);
});

test('an allowed in-scope action does not drop trust (before == after)', async () => {
  const r = await maybeEnforce(agent, {
    action: 'rag:read',
    resource: 'doc://kb',
    context: { tool: 'rag_fetch' },
  });
  assert.equal(r.allowed, true, 'rag:read is inside the grant');
  assert.equal(
    r.trustDelta.before.score,
    r.trustDelta.after.score,
    'an allowed action leaves the score unchanged',
  );
});

test('behavioral trust is floored and never collapses to zero', async () => {
  for (let i = 0; i < 20; i++) await denyOnce();
  const r = await denyOnce();
  assert.ok(
    r.trustDelta.after.score >= r.trustDelta.floor,
    'score never drops below the floor',
  );
  assert.equal(r.trustDelta.after.score, r.trustDelta.floor, 'saturates at the floor');
  // The diagnostic reader applies the same penalty as the enforcer.
  const diag = readTrustScore(agent);
  assert.equal(diag.score, r.trustDelta.after.score);
});
