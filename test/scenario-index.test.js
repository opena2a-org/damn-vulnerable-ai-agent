/**
 * docs/scenarios/README.md is generated from the scenario files (#101).
 * If this fails, run: node scripts/gen-scenario-index.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderIndex, INDEX_PATH } from '../scripts/gen-scenario-index.mjs';

const SCENARIOS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scenarios');

test('docs/scenarios/README.md matches the generator output', () => {
  assert.equal(fs.readFileSync(INDEX_PATH, 'utf-8'), renderIndex(),
    'docs/scenarios/README.md is stale. Run: node scripts/gen-scenario-index.mjs');
});

test('the index lists every scenario once, with the checks from its expected-checks.json', () => {
  const index = renderIndex();
  const names = fs.readdirSync(SCENARIOS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== 'examples')
    .map(e => e.name);
  for (const name of names) {
    const rows = index.split('\n').filter(line => line.startsWith(`| \`${name}\` |`));
    assert.equal(rows.length, 1, `${name} should appear in exactly one row`);
    const expected = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, name, 'expected-checks.json'), 'utf-8'));
    if (expected.length > 0) {
      assert.ok(rows[0].includes(`| ${expected.join(', ')} |`), `${name}: row should list ${expected.join(', ')}: ${rows[0]}`);
    }
  }
});
