/**
 * Port-publish hints bind to loopback (#129, #134).
 *
 * DVAA's agents are vulnerable on purpose, so every `docker run` hint in this
 * repository publishes their ports on 127.0.0.1 only. A `-p` or `--publish`
 * value with no host address in front publishes on every host interface and
 * exposes the agents to the local network: `<port>:<port>`, a range
 * `<first>-<last>:<first>-<last>`, or a container port alone (`<port>`, which
 * docker maps to a random host port). The scan finds the flag after any
 * non-word character (so markdown or HTML markup does not hide it), with the
 * value after whitespace, after `=`, attached to the flag, or as the next
 * element of an argv array on the same line (`"-p", "<port>:<port>"`). A
 * container port alone counts only after `docker run`, `docker create` or the
 * podman equivalents on the same line, with no `&&`, `;` or `|` in between, and
 * only with whitespace or `=` before it, because `-p <number>` is also an
 * ordinary option of ssh, nc, ps, mysql and dev servers. A value that names a
 * host is allowed, including an explicit `0.0.0.0:` or `[::]:` written on
 * purpose (DOCKER_README.md documents one for lab use).
 *
 * Not covered: combined short options (`-dp 9000:9000`), `-P` and
 * `--publish-all`, the long syntax (`--publish published=9000,target=9000`), a
 * port held in a variable, a flag and its value on separate lines (a `\`
 * continuation or a multi-line argv array), bash arrays (`("-p" "9000:9000")`),
 * and compose `ports:` entries. Still flagged although it is not a publish: a
 * lone `-p <number>` of a command run inside the container on a `docker run`
 * line (`docker run busybox nc -l -p <port>`).
 *
 * The tree is walked with fs rather than `git ls-files` so the test also runs
 * where .git is absent. Skipped: dependency and VCS directories, runtime state
 * the server or tools write into the checkout, CHANGELOG.md (it records past
 * hints as history), and the scenarios/<name>/vulnerable scanner fixture
 * trees.
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
const FIXTURE_TREE = 'vulnerable';

// `-p` or `--publish` after any non-word character, then a value that starts
// with a port number: after whitespace, `=` or nothing, or after the closing
// quote and comma of an argv-array element. The value is a port or range,
// optionally `:<port or range>`. The lookahead rejects a value that goes on as
// an IP address (127.0.0.1:..., also with escaped dots as in a regex), so a
// value with a host address in front does not match.
const ALL_INTERFACES = /(?<!\w)(?:-p|--publish)(?:\s+|=|["'`]\s*,\s*)?["'`]?(\d+(?:-\d+)?(?::\d+(?:-\d+)?)?)(?!\d|\\*\.\d)/g;

function isFixtureTree(rel) {
  const parts = rel.split(path.sep);
  return parts.length === 3 && parts[0] === 'scenarios' && parts[2] === FIXTURE_TREE;
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

// A container port alone is a publish only as an option of `docker run` or
// `docker create` (or podman's), so it counts only when such a command precedes
// the flag on the line with no `&&`, `;` or `|` between them, and only with
// whitespace or `=` before the value (`-p1234` is mysql's password form).
const CONTAINER_RUN = /\b(?:docker|podman)\s+(?:container\s+)?(?:run|create)\b/gi;
const ATTACHED = /^(?:-p|--publish)["'`]?\d/;

function loneIsPublish(text, m) {
  if (ATTACHED.test(m[0])) return false;
  const before = text.slice(0, m.index);
  const runs = [...before.matchAll(CONTAINER_RUN)];
  if (runs.length === 0) return false;
  const last = runs[runs.length - 1];
  return !/&&|;|\|/.test(before.slice(last.index + last[0].length));
}

function findHits(text) {
  return [...text.matchAll(ALL_INTERFACES)]
    .filter((m) => m[1].includes(':') || loneIsPublish(text, m))
    .map((m) => m[1]);
}

test('the pattern flags a publish with no host address in the forms it covers', () => {
  // Built at run time so these lines do not trip the scan below.
  const p = '-p';
  const pub = `-${p}ublish`;
  const cases = [
    [`docker run ${p} 9000:9000 opena2a/dvaa`, '9000:9000'],
    [`Or: docker run ${p} 7001-7008:7001-7008 opena2a/dvaa`, '7001-7008:7001-7008'],
    [`"${p} 7010-7013:7010-7013 "`, '7010-7013:7010-7013'],
    [`docker run ${pub}=9000:9000 opena2a/dvaa`, '9000:9000'],
    [`docker run ${pub} 9000:9000 opena2a/dvaa`, '9000:9000'],
    // A container port alone: docker picks a random host port on every interface.
    [`docker run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker run ${pub}=9000 opena2a/dvaa`, '9000'],
    [`docker run ${p} 9000/tcp opena2a/dvaa`, '9000'],
    [`podman run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker create ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker container run ${pub}=9000 opena2a/dvaa`, '9000'],
    // A mapping followed by punctuation or prose.
    [`docker run ${p} 9000:9000: the agent answers on 9000`, '9000:9000'],
    [`a ${p} 9000:9000-style mapping`, '9000:9000'],
    // A value attached to the flag.
    [`docker run ${p}9000:9000 opena2a/dvaa`, '9000:9000'],
    [`docker run ${p}=9000:9000 opena2a/dvaa`, '9000:9000'],
    // The flag after markup or punctuation.
    [`Use **${p} 9000:9000** here.`, '9000:9000'],
    [`<code>${p} 9000:9000</code>`, '9000:9000'],
    [`[${p} 9000:9000]`, '9000:9000'],
    [`|${p} 9000:9000|`, '9000:9000'],
    [`Publish it with docker run ${p} 9000.`, '9000'],
    // The argv-array form.
    [`spawn("docker", ["run", "${p}", "9000:9000", "opena2a/dvaa"])`, '9000:9000'],
    [`subprocess.run(['docker', 'run', '${pub}', '7001-7008:7001-7008'])`, '7001-7008:7001-7008'],
    [`["run", "${p}9000:9000"]`, '9000:9000'],
  ];
  for (const [line, value] of cases) {
    assert.deepEqual(findHits(line), [value], `not flagged as it should be: ${line}`);
  }
});

test('the pattern passes a publish that names a host address', () => {
  const lines = [
    'docker run -p 127.0.0.1:9000:9000 opena2a/dvaa',
    'docker run -p 127.0.0.1:7001-7008:7001-7008 opena2a/dvaa',
    'docker run --publish=127.0.0.1:9000:9000 opena2a/dvaa',
    'spawn("docker", ["run", "-p", "127.0.0.1:9000:9000", "opena2a/dvaa"])',
    '/docker run --rm -p 127\\.0\\.0\\.1:9000:9000 opena2a\\/dvaa/',
    // An explicit all-interfaces host is a deliberate choice, not an omission.
    'docker run -p 0.0.0.0:9000:9000 opena2a/dvaa',
    'docker run -p [::]:9000:9000 opena2a/dvaa',
    'mkdir -p 2026-10-07',
  ];
  for (const line of lines) {
    assert.deepEqual(findHits(line), [], `flagged but names a host: ${line}`);
  }
});

test('the pattern passes -p <number> options that are not a docker or podman run publish', () => {
  const lines = [
    'ssh -p 2222 user@host',
    'nc -l -p 4444',
    'ps -p 1234',
    'next dev -p 3000',
    'docker exec db mysql -uroot -p1234',
    'docker run --rm mysql:8 mysql -uroot -p1234',
    'docker exec web ps -p 1',
    'docker compose -p 2026 up',
    'docker run --rm opena2a/dvaa && ssh -p 2222 user@host',
    'docker run --rm opena2a/dvaa; ssh -p 2222 user@host',
    'docker run --rm opena2a/dvaa | nc -l -p 4444',
  ];
  for (const line of lines) {
    assert.deepEqual(findHits(line), [], `flagged but is not a container publish: ${line}`);
  }
});

test('the walk reaches the example scripts and skips the scanner fixtures', () => {
  const files = walk(REPO_ROOT);
  assert.ok(files.includes(path.join('scenarios', 'examples', 'README.md')), 'scenarios/examples/README.md not walked');
  assert.ok(files.includes(path.join('src', 'dashboard', 'server.js')), 'src/dashboard/server.js not walked');
  const scenariosDir = path.join(REPO_ROOT, 'scenarios');
  const withFixtures = fs.readdirSync(scenariosDir)
    .filter((name) => fs.existsSync(path.join(scenariosDir, name, 'vulnerable')));
  assert.ok(withFixtures.length > 0, 'no scenarios/<name>/vulnerable tree on disk');
  const walkedFixtures = files.filter((f) => /^scenarios[\\/][^\\/]+[\\/]vulnerable[\\/]/.test(f));
  assert.deepEqual(walkedFixtures, [], 'fixture files were walked');
});

test('no text file publishes a container port without a host address', () => {
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
