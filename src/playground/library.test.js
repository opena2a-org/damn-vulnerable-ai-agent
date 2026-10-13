/**
 * Best-practices library tests (issue #94).
 *
 * Score bands come from the playground's own scale. The results gauge
 * (public/playground.html, public/js/playground.js updateScoreMeter) splits
 * 0-100 into five 20-point levels: Critical 0-20, Vulnerable 21-40,
 * Weak 41-60, Standard 61-80, Hardened 81-100. An example passes when the
 * simulated standard run puts it in the same level as its expectedScore,
 * which is what a learner sees on the gauge.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BEST_PRACTICES_LIBRARY, getExample, getAllExamples } from './library.js';
import { PlaygroundEngine } from './engine.js';
import { PromptAnalyzer } from './analyzer.js';

const LEVELS = [
  { name: 'Critical', min: 0, max: 20 },
  { name: 'Vulnerable', min: 21, max: 40 },
  { name: 'Weak', min: 41, max: 60 },
  { name: 'Standard', min: 61, max: 80 },
  { name: 'Hardened', min: 81, max: 100 },
];

function levelOf(score) {
  return LEVELS.find(level => score >= level.min && score <= level.max);
}

const engine = new PlaygroundEngine();
const scored = BEST_PRACTICES_LIBRARY.filter(example => example.expectedScore !== null);

test('library entries are well formed', () => {
  assert.equal(getAllExamples(), BEST_PRACTICES_LIBRARY);
  const ids = BEST_PRACTICES_LIBRARY.map(example => example.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate example ids');
  for (const example of BEST_PRACTICES_LIBRARY) {
    assert.equal(typeof example.name, 'string', example.id);
    assert.equal(typeof example.prompt, 'string', example.id);
    assert.equal(typeof example.description, 'string', example.id);
    if (example.expectedScore !== null) {
      assert.ok(Number.isInteger(example.expectedScore), example.id);
      assert.ok(example.expectedScore >= 0 && example.expectedScore <= 100, example.id);
      assert.ok(example.prompt.trim().length > 0, `${example.id} has a score but no prompt`);
    }
  }
});

test('getExample finds an example by id and misses unknown ids', () => {
  assert.equal(getExample('insecure-basic').id, 'insecure-basic');
  assert.equal(getExample('no-such-example'), undefined);
});

for (const example of scored) {
  test(`${example.id} scores in the same gauge level as its expectedScore`, async () => {
    const results = await engine.testPrompt(example.prompt, { intensity: 'standard' });
    const expected = levelOf(example.expectedScore);
    const actual = levelOf(results.overallScore);
    const verdicts = results.attacks.map(a => `${a.id}=${a.verdict}`).join(' ');
    assert.equal(actual.name, expected.name,
      `${example.id}: score ${results.overallScore} (${actual.name}) vs expectedScore ` +
      `${example.expectedScore} (${expected.name} ${expected.min}-${expected.max}); ${verdicts}`);
  });
}

test('every example labelled HARDENED or STANDARD lands in the Hardened or Standard level', async () => {
  for (const example of scored.filter(e => /^\[(HARDENED|STANDARD)\]/.test(e.name))) {
    const { overallScore } = await engine.testPrompt(example.prompt, { intensity: 'standard' });
    assert.ok(overallScore > 60, `${example.id} scored ${overallScore}`);
  }
});

test('applying the recommendations to a weak example raises its score', async () => {
  const analyzer = new PromptAnalyzer();
  const example = getExample('insecure-basic');
  const before = await engine.testPrompt(example.prompt, { intensity: 'standard' });
  const recommendations = analyzer.generateRecommendations(example.prompt, before);
  const enhanced = analyzer.applyRecommendations(example.prompt, recommendations);
  const after = await engine.testPrompt(enhanced, { intensity: 'standard' });
  assert.ok(after.overallScore > before.overallScore,
    `score ${before.overallScore} -> ${after.overallScore}; enhanced prompt:\n${enhanced}`);
});
