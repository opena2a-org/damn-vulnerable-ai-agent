/**
 * Port-publish hints bind to loopback (#129).
 *
 * DVAA's agents are vulnerable on purpose, so every `docker run` hint in this
 * repository publishes their ports on 127.0.0.1 only. A `-p <port>:<port>`
 * (or `-p <first>-<last>:<first>-<last>`) with no host address publishes on
 * every host interface and exposes the agents to the local network.
 *
 * The tree is walked with fs rather than `git ls-files` so the test also runs
 * where .git is absent. Skipped: dependency and VCS directories, runtime state
 * the server or tools write into the checkout, CHANGELOG.md (it records past
 * hints as history), and the scenarios/<name>/vulnerable and
 * scenarios/<name>/secure scanner fixture trees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_NAMES = new Set([
  'node_modules', '.git', '.worktrees', '.dvaa', '.dvaa-aim',
  '.hackmyagent-cache', '.hackmyagent-backup', 'coverage', 'dist', '.playwright-mcp',
]);
const SKIP_FILES = new Set(['CHANGELOG.md']);
const FIXTURE_TREES = new Set(['vulnerable', 'secure']);

// `-p` or `--publish`, then a value that starts with a port number. A value
// with a host address in front (127.0.0.1:...) does not match.
const ALL_INTERFACES = /(?:^|[\s"'`(])(?:-p|--publish)(?:\s+|=)["']?(\d+(?:-\d+)?:\d+(?:-\d+)?)/g;

function isFixtureTree(rel) {
  const parts = rel.split(path.sep);
  return parts.length === 3 && parts[0] === 'scenarios' && FIXTURE_TREES.has(parts[2]);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, full);
    if (entry.isDirectory()) {
      if (!isFixtureTree(rel)) walk(full, out);
    } else if (entry.isFile() && !SKIP_FILES.has(rel)) {
      out.push(rel);
    }
  }
  return out;
}

function findHits(text) {
  return [...text.matchAll(ALL_INTERFACES)].map((m) => m[1]);
}

test('the pattern flags an all-interfaces publish and passes a loopback one', () => {
  // Built at run time so these lines do not trip the scan below.
  const p = '-p';
  assert.deepEqual(findHits(`docker run ${p} 9000:9000 opena2a/dvaa`), ['9000:9000']);
  assert.deepEqual(findHits(`Or: docker run ${p} 7001-7008:7001-7008 opena2a/dvaa`), ['7001-7008:7001-7008']);
  assert.deepEqual(findHits(`"${p} 7010-7013:7010-7013 "`), ['7010-7013:7010-7013']);
  assert.deepEqual(findHits(`docker run -${p}ublish=9000:9000 opena2a/dvaa`), ['9000:9000']);
  assert.deepEqual(findHits('docker run -p 127.0.0.1:9000:9000 opena2a/dvaa'), []);
  assert.deepEqual(findHits('docker run -p 127.0.0.1:7001-7008:7001-7008 opena2a/dvaa'), []);
});

test('the walk reaches the example scripts and skips the scanner fixtures', () => {
  const files = walk(REPO_ROOT);
  assert.ok(files.includes(path.join('scenarios', 'examples', 'README.md')), 'scenarios/examples/README.md not walked');
  assert.ok(files.includes(path.join('src', 'dashboard', 'server.js')), 'src/dashboard/server.js not walked');
  const scenariosDir = path.join(REPO_ROOT, 'scenarios');
  const withFixtures = fs.readdirSync(scenariosDir)
    .filter((name) => fs.existsSync(path.join(scenariosDir, name, 'vulnerable')));
  assert.ok(withFixtures.length > 0, 'no scenarios/<name>/vulnerable tree on disk');
  const walkedFixtures = files.filter((f) => /^scenarios[\\/][^\\/]+[\\/](vulnerable|secure)[\\/]/.test(f));
  assert.deepEqual(walkedFixtures, [], 'fixture files were walked');
});

test('no text file publishes a container port on every interface', () => {
  const hits = [];
  for (const rel of walk(REPO_ROOT)) {
    const buf = fs.readFileSync(path.join(REPO_ROOT, rel));
    if (buf.includes(0)) continue; // binary
    buf.toString('utf8').split('\n').forEach((line, i) => {
      for (const value of findHits(line)) hits.push(`${rel}:${i + 1}: -p ${value}`);
    });
  }
  assert.deepEqual(hits, [], `use -p 127.0.0.1:<port>:<port> instead:\n${hits.join('\n')}`);
});
