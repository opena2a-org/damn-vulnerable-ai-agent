/**
 * Smoke test for `dvaa selftest --help` and the deprecated `dvaa browse` alias.
 *
 * 0.9.0's release-test caught that the command's --help fell back to root help.
 * This test locks in the command-specific help so that regression can't return,
 * and pins the 2026-08-26 surface change: `browse` became `selftest`
 * (honest name — it runs local agents, never a target URL), the target-implying
 * output is gone, `--publish` is removed, and `browse` survives only as a
 * deprecated alias that prints a corrective note.
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

function run(cmd, args) {
  return spawnSync('node', [CLI, cmd, ...args], {
    encoding: 'utf-8', shell: false, timeout: 8_000,
  });
}

console.log('dvaa selftest --help tests\n==========================\n');

test('selftest --help exits 0 and prints command-specific usage', () => {
  const r = run('selftest', ['--help']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  const out = r.stdout + r.stderr;
  assert.ok(out.includes('dvaa selftest'), 'header missing');
  assert.ok(out.includes('--agents'), 'expected --agents flag in help');
  assert.ok(out.includes('--categories'), 'expected --categories flag in help');
  assert.ok(out.includes('--json'), 'expected --json flag in help');
});

test('selftest help no longer advertises the removed publish/target surface', () => {
  const r = run('selftest', ['--help']);
  const out = r.stdout + r.stderr;
  assert.ok(!out.includes('--publish'), '--publish must be gone from the surface');
  assert.ok(!/\[target\]/.test(out), 'the [target] positional must be gone');
  assert.ok(!out.includes('agentpwn.com'), 'no default-target hint — selftest runs local agents');
  assert.ok(/local/i.test(out), 'help must state that it runs local agents');
});

test('-h alias works the same as --help', () => {
  const r = run('selftest', ['-h']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  assert.ok((r.stdout + r.stderr).includes('dvaa selftest'), 'header missing on -h');
});

test('deprecated `browse` alias reaches selftest help and prints a corrective note', () => {
  const r = run('browse', ['--help']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  assert.ok(r.stderr.includes('now `dvaa selftest`'), 'expected the deprecation note on stderr');
  const out = r.stdout + r.stderr;
  assert.ok(out.includes('dvaa selftest'), 'browse alias must route to selftest help');
});

test('the deprecation note goes to stderr, never stdout (so `browse --json` stays parseable)', () => {
  const r = run('browse', ['--json', '--agents', '__none__']);
  // No agent named __none__ -> the run reports "No DVAA agents running" and exits;
  // what matters here is that the deprecation note never lands on stdout.
  assert.ok(!r.stdout.includes('now `dvaa selftest`'), 'deprecation note leaked onto stdout');
  assert.ok(r.stderr.includes('now `dvaa selftest`'), 'deprecation note missing from stderr');
});

test('--help does NOT fall back to root help (regression from 0.9.0 release-test)', () => {
  for (const cmd of ['selftest', 'browse']) {
    const r = run(cmd, ['--help']);
    const out = r.stdout + r.stderr;
    assert.ok(!out.includes('Server options'), `root help leaked through for ${cmd}`);
    assert.ok(!out.includes('Dashboard:  http://localhost:9000'), `root help leaked through for ${cmd}`);
  }
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
