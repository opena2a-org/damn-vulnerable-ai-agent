/**
 * Scans and fixes do not modify the shipped scenario fixtures (#99).
 *
 * runScan() copies scenarios/<name>/vulnerable/ into a per-request temporary
 * directory, runs HackMyAgent there, reports what --fix changed, and removes
 * the copy. The first two tests run the locally installed HackMyAgent against
 * the real shipped fixture and compare every byte before and after. The last
 * one uses a stub binary to record the exact HackMyAgent argv.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runScan, lineDiff } from '../src/dashboard/scanner.js';
import { getHmaBinPath } from '../src/cli/hma.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// LLM-001 fires on this fixture and HackMyAgent can auto-fix it.
const NAME = 'llm-exposed-ollama';
const EXPECTED = ['LLM-001'];
const SCENARIO_DIR = path.join(REPO_ROOT, 'scenarios', NAME);
const skip = getHmaBinPath() ? false : 'hackmyagent is not installed';

// Relative path -> sha256 for files, 'dir' for directories.
function snapshot(root) {
  const out = {};
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs);
      if (entry.isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(abs);
      } else {
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
      }
    }
  })(root);
  return out;
}

// Runs fn against the shipped fixture. If fn writes to the fixture anyway, the
// original is put back so the working tree is not left remediated, and the
// test fails with the list of paths that changed.
async function withFixtureGuard(fn) {
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-fixture-backup-'));
  fs.cpSync(SCENARIO_DIR, backup, { recursive: true });
  const before = snapshot(SCENARIO_DIR);
  try {
    return await fn();
  } finally {
    const after = snapshot(SCENARIO_DIR);
    const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter(p => before[p] !== after[p]);
    if (changed.length > 0) {
      fs.rmSync(SCENARIO_DIR, { recursive: true, force: true });
      fs.cpSync(backup, SCENARIO_DIR, { recursive: true });
    }
    fs.rmSync(backup, { recursive: true, force: true });
    assert.deepEqual(changed, [], `scenarios/${NAME} was modified: ${changed.join(', ')}`);
  }
}

test('a fix run leaves the shipped fixture byte-identical and reports what it changed', { skip }, async () => {
  const result = await withFixtureGuard(() =>
    runScan({ pkgRoot: REPO_ROOT, name: NAME, expected: EXPECTED, fix: true }));

  const detail = result.expectedDetail.find(d => d.checkId === 'LLM-001');
  assert.equal(detail?.status, 'fixed', `LLM-001 should be resolved by the fix: ${JSON.stringify(result.expectedDetail)}`);
  assert.deepEqual(result.fired, [], `nothing expected should still fire after the fix: ${JSON.stringify(result)}`);

  assert.ok(result.changes, `a fix run reports a diff summary: ${JSON.stringify(result)}`);
  const compose = result.changes.files.find(f => f.path === 'docker-compose.yml');
  assert.equal(compose?.status, 'modified', `docker-compose.yml should be reported as modified: ${JSON.stringify(result.changes)}`);
  assert.ok(compose.removed > 0 && compose.added > 0, `line counts for docker-compose.yml: ${JSON.stringify(compose)}`);
  assert.ok(compose.preview.some(line => line.startsWith('- ')), `preview shows the removed line: ${JSON.stringify(compose.preview)}`);
  assert.ok(!result.changes.files.some(f => f.path.startsWith('.hackmyagent-backup')),
    `HackMyAgent's backup directory is not part of the diff: ${JSON.stringify(result.changes.files)}`);
});

test('the diff summary counts changed lines exactly', () => {
  const added = lineDiff(undefined, Buffer.from('a\nb\n'));
  assert.deepEqual([added.added, added.removed, added.preview], [2, 0, ['+ a', '+ b']]);
  const removed = lineDiff(Buffer.from('only\n'), undefined);
  assert.deepEqual([removed.added, removed.removed, removed.preview], [0, 1, ['- only']]);
  const modified = lineDiff(Buffer.from('x\ny\nz\n'), Buffer.from('x\nY\nz\n'));
  assert.deepEqual([modified.added, modified.removed, modified.preview], [1, 1, ['- y', '+ Y']]);
  const long = lineDiff(undefined, Buffer.from(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')));
  assert.deepEqual([long.added, long.preview.length, long.truncated], [20, 12, true]);
  assert.equal(lineDiff(Buffer.from([0x61, 0x00]), Buffer.from([0x62, 0x00])).binary, true);
});

test('a plain scan leaves the shipped fixture byte-identical', { skip }, async () => {
  const result = await withFixtureGuard(() =>
    runScan({ pkgRoot: REPO_ROOT, name: NAME, expected: EXPECTED }));
  assert.deepEqual(result.fired, EXPECTED, `LLM-001 should fire on the shipped fixture: ${JSON.stringify(result)}`);
  assert.equal(result.changes, null);
});

test('every HackMyAgent scan is local-only, static and scoped to the fixture copy', async (t) => {
  // Stub layout mirrors a real install: <root>/node_modules/.bin/hackmyagent.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-stub-hma-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binDir = path.join(root, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const log = path.join(root, 'argv.log');
  const stub = path.join(binDir, 'hackmyagent');
  fs.writeFileSync(stub, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    'const argv = process.argv.slice(2);',
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');`,
    "if (argv.includes('--version')) { console.log('hackmyagent 0.0.0'); process.exit(0); }",
    "if (argv[0] === 'check-metadata') { console.log('{\"checks\":{}}'); process.exit(0); }",
    "console.log(JSON.stringify({ findings: [] }));",
  ].join('\n'));
  fs.chmodSync(stub, 0o755);

  const pkgRoot = path.join(root, 'pkg');
  fs.cpSync(path.join(SCENARIO_DIR, 'vulnerable'), path.join(pkgRoot, 'scenarios', NAME, 'vulnerable'), { recursive: true });

  await runScan({ pkgRoot, name: NAME, expected: EXPECTED, fix: true, hmaBin: stub });

  const scans = fs.readFileSync(log, 'utf-8').trim().split('\n').map(line => JSON.parse(line))
    .filter(argv => argv[0] === 'secure');
  assert.equal(scans.length, 3, `baseline scan, fix run and re-scan: ${JSON.stringify(scans)}`);
  for (const argv of scans) {
    for (const flag of ['--no-registry', '--no-contribute', '--static-only', '--no-machine-posture']) {
      assert.ok(argv.includes(flag), `${flag} missing from: ${argv.join(' ')}`);
    }
    assert.ok(!argv[1].startsWith(pkgRoot), `scan target must be a temporary copy, got ${argv[1]}`);
  }
  assert.equal(scans.filter(argv => argv.includes('--fix')).length, 1, 'exactly one run applies --fix');
  assert.ok(!fs.existsSync(scans[0][1]), 'the temporary copy is removed after the run');
});
