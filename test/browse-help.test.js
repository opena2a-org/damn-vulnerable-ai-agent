/**
 * Smoke test for `dvaa browse --help`.
 *
 * 0.9.0's release-test caught that `dvaa browse --help` fell back to
 * `dvaa --help` (root help) because src/browse.js had no --help case.
 * This test locks in the browse-specific help so the regression can't
 * silently come back.
 */

import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const CLI = path.join(REPO_ROOT, 'src', 'index.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

function runBrowse(args) {
  return spawnSync('node', [CLI, 'browse', ...args], {
    encoding: 'utf-8', shell: false, timeout: 8_000,
  });
}

console.log('dvaa browse --help tests\n=========================\n');

test('--help exits 0 and prints browse-specific usage', () => {
  const r = runBrowse(['--help']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.ok(out.includes('dvaa browse'), 'header missing');
  assert.ok(out.includes('target'), 'target arg description missing');
  assert.ok(out.includes('--agents'), 'expected --agents flag in help');
  assert.ok(out.includes('--categories'), 'expected --categories flag in help');
  assert.ok(out.includes('--json'), 'expected --json flag in help');
  assert.ok(out.includes('--publish'), 'expected --publish flag in help');
  assert.ok(out.includes('agentpwn.com'), 'expected default target hint');
});

test('-h alias works the same as --help', () => {
  const r = runBrowse(['-h']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.ok(out.includes('dvaa browse'), 'header missing on -h');
});

test('--help does NOT fall back to root help (regression from 0.9.0 release-test)', () => {
  const r = runBrowse(['--help']);
  const out = r.stdout + r.stderr;
  // Root help includes phrases unique to it (e.g. "Server options" + "Dashboard:  http://localhost:9000").
  // Browse help must not contain those — that's the bug class.
  assert.ok(!out.includes('Server options'), 'root help leaked through — browse --help is falling back');
  assert.ok(!out.includes('Dashboard:  http://localhost:9000'), 'root help leaked through');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
