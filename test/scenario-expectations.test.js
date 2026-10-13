/**
 * Scenario metadata matches what the shipped HackMyAgent detects (#100, #103, #108).
 *
 * - every scenario with expected checks ships its vulnerable/ fixture, apart
 *   from the known gaps listed below;
 * - every expected check fires on the shipped fixture, through the same scan
 *   path the dashboard and `dvaa scan` use (runScan);
 * - README metadata the scenario browser parses is well formed;
 * - the unicode-stego-package fixture carries real invisible codepoints.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScan } from '../src/dashboard/scanner.js';
import { getHmaBinPath } from '../src/cli/hma.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS_DIR = path.join(REPO_ROOT, 'scenarios');

// Fixtures missing from the repository: the root .gitignore excludes the env
// fixtures (#103), and the webexpose-claude-md fixture is not committed yet
// (#108). Remove an entry once its fixture is committed. A missingFixture
// entry tolerates no check: once its vulnerable/ directory exists, every
// expected check must fire.
const KNOWN_GAPS = {
  'webexpose-claude-md': { issue: 108, missingFixture: true },
  'webexpose-env-file': { issue: 103, missingFixture: true },
  'supply-chain-to-rce': { issue: 103, ids: ['CONFIG-004', 'CRED-001', 'GIT-003', 'SEM-CRED-001', 'SEM-CRED-002'] },
  'behavioral-drift-to-exfil': { issue: 103, ids: ['GIT-003', 'SEM-CRED-001', 'SEM-CRED-002'] },
};

const scenarios = fs.readdirSync(SCENARIOS_DIR, { withFileTypes: true })
  .filter(e => e.isDirectory() && e.name !== 'examples')
  .map(e => {
    const dir = path.join(SCENARIOS_DIR, e.name);
    return {
      name: e.name,
      dir,
      expected: JSON.parse(fs.readFileSync(path.join(dir, 'expected-checks.json'), 'utf-8')),
      readme: fs.readFileSync(path.join(dir, 'README.md'), 'utf-8'),
    };
  });

test('every expected-checks.json is an array of unique check IDs', () => {
  for (const s of scenarios) {
    assert.ok(Array.isArray(s.expected), `${s.name}: expected-checks.json is not an array`);
    for (const id of s.expected) {
      assert.match(id, /^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/, `${s.name}: malformed check ID ${JSON.stringify(id)}`);
    }
    assert.equal(new Set(s.expected).size, s.expected.length, `${s.name}: duplicate check IDs`);
  }
});

test('every scenario with expected checks ships its vulnerable/ fixture', (t) => {
  for (const s of scenarios.filter(x => x.expected.length > 0)) {
    const present = fs.existsSync(path.join(s.dir, 'vulnerable'));
    if (!present && KNOWN_GAPS[s.name]?.missingFixture) {
      t.diagnostic(`${s.name}: no vulnerable/ directory, known gap (#${KNOWN_GAPS[s.name].issue})`);
      continue;
    }
    assert.ok(present, `${s.name} expects ${s.expected.join(', ')} but has no vulnerable/ directory`);
  }
});

test('every README states its severity in the bold form the scenario browser parses', () => {
  for (const s of scenarios) {
    assert.match(s.readme, /\*\*Severity:\*\*\s+(Critical|High|Medium|Low)\b/,
      `${s.name}/README.md has no "**Severity:** <Critical|High|Medium|Low>"`);
  }
});

test('a scenario with no expected checks explains its detection status and claims no auto-fix', () => {
  for (const s of scenarios.filter(x => x.expected.length === 0)) {
    assert.match(s.readme, /^## Detection status\s*$/m, `${s.name}/README.md has no "## Detection status" section`);
    assert.doesNotMatch(s.readme, /\*\*Auto-Fix:\*\*\s+Yes/, `${s.name}/README.md claims auto-fix but no check fires`);
  }
});

test('every expected check fires on the shipped fixture', { skip: getHmaBinPath() ? false : 'hackmyagent is not installed' }, async (t) => {
  const targets = scenarios.filter(s => s.expected.length > 0 && fs.existsSync(path.join(s.dir, 'vulnerable')));
  const results = [];
  for (let i = 0; i < targets.length; i += 6) {
    results.push(...await Promise.all(targets.slice(i, i + 6).map(s =>
      runScan({ pkgRoot: REPO_ROOT, name: s.name, expected: s.expected }))));
  }
  const problems = [];
  for (const r of results) {
    const gap = KNOWN_GAPS[r.name]?.ids || [];
    for (const id of r.missing) {
      if (gap.includes(id)) t.diagnostic(`${r.name}: ${id} does not fire, known gap (#${KNOWN_GAPS[r.name].issue})`);
      else problems.push(`${r.name}: ${id} did not fire`);
    }
    // An "**Auto-Fix:** Yes" claim needs an expected check that HackMyAgent can fix.
    const readme = scenarios.find(s => s.name === r.name).readme;
    if (/\*\*Auto-Fix:\*\*\s+Yes/.test(readme) && !r.expectedDetail.some(d => d.status === 'fired' && d.fixable)) {
      problems.push(`${r.name}: README claims auto-fix but no expected check is fixable`);
    }
  }
  assert.deepEqual(problems, [], `scenario metadata disagrees with the shipped HackMyAgent:\n${problems.join('\n')}`);
});

test('unicode-stego-package hides its instructions in real invisible codepoints', () => {
  const text = fs.readFileSync(path.join(SCENARIOS_DIR, 'unicode-stego-package', 'vulnerable', 'SKILL.md'), 'utf-8');
  assert.match(text, /[\u{200B}-\u{200D}]/u, 'zero-width space/joiner (U+200B to U+200D)');
  assert.match(text, /[\u{E0000}-\u{E007F}]/u, 'tag characters (U+E0000 to U+E007F)');
  assert.match(text, /[\u{E0100}-\u{E01EF}]/u, 'variation selectors (U+E0100 to U+E01EF)');
  assert.doesNotMatch(text, /&#x[0-9a-f]+;/i, 'HTML entity text is visible, not hidden');
  assert.doesNotMatch(text, /IGNORE PREVIOUS/, 'the hidden instruction must not appear as visible text');
});
