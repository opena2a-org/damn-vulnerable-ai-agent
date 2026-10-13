/**
 * `dvaa demo flight` removes its temp directory on every exit path (#97).
 *
 * The early exit is the one a presenter hits most: a fleet already holds
 * 7017/7018, ensureFleet() refuses through process.exit(), and the finally
 * block that used to remove the directory never runs. This test needs those
 * ports held by a running fleet (the container harness), so the demo exits
 * there and never spawns a fleet of its own; it skips everywhere else.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

async function isUp(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; }
}

test('live: an early exit (ports in use) leaves no dvaa-flight-* directory behind', async (t) => {
  const held = (await isUp('http://localhost:7017/health')) && (await isUp('http://localhost:7018/health'));
  if (!held) { t.skip('7017/7018 not held by a running fleet; the demo would start its own'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-flight-cleanup-'));
  try {
    const r = spawnSync(process.execPath, [CLI, 'demo', 'flight', '--json'], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { PATH: process.env.PATH, HOME: tmp, TMPDIR: tmp, OPENA2A_TELEMETRY: 'off' },
    });
    const show = `exit=${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;
    assert.equal(r.status, 1, show);
    assert.match(r.stderr, /already in use/, show);
    const left = fs.readdirSync(tmp).filter(n => n.startsWith('dvaa-flight-'));
    assert.deepEqual(left, [], `temp directories left behind: ${left.join(', ')}\n${show}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
