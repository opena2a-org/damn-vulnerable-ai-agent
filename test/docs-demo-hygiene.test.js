/**
 * Docs and demo-script hygiene (#110, #111).
 *
 *   - No text file under docs/ contains a /Users/ path. A reader of this
 *     repository cannot open a file on one developer's machine, so a step that
 *     depends on it cannot be followed. Only the /Users/ form is checked: a
 *     /home/<user>/ or C:\Users\ path passes.
 *   - docs/demo/setup-aim-local.sh seeds the local AIM admin over psql's stdin.
 *     It used to write the seed SQL to a fixed host path under /tmp, which
 *     another local user can pre-create as a symlink (CWE-377), and it spliced
 *     the admin email into the lookup SQL by shell interpolation.
 *
 * The script runs against stub `docker` and `curl` binaries placed first on
 * PATH, with AIM_ROOT pointing at a throwaway directory. The curl stub answers
 * the health check and fails the login that follows the seed step, so the run
 * stops before it would generate an identity under the checkout. No container,
 * network or AIM stack is touched.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs');
const SCRIPT = path.join(DOCS_DIR, 'demo', 'setup-aim-local.sh');
const ADMIN_EMAIL = 'admin@opena2a.org';

const BINARY_EXTENSIONS = new Set(['.png', '.gif', '.jpg', '.jpeg', '.webp', '.ico']);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && !BINARY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

test('no text file under docs/ contains a /Users/ path', () => {
  const hits = [];
  for (const file of walk(DOCS_DIR)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (line.includes('/Users/')) hits.push(`${path.relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], `local paths found:\n${hits.join('\n')}`);
});

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-aim-setup-test-'));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

// Stub docker: records each call's argv, and its stdin when `docker exec -i`
// would forward stdin. A psql call with -tA is the admin lookup; it prints the
// count the test asks for, or fails when LOOKUP_FAILS is set.
const DOCKER_STUB = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const container = args.indexOf('aim-postgres');
const forwardsStdin = args[0] === 'exec' && container > 0 && args.slice(1, container).includes('-i');
const stdin = forwardsStdin ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ args, stdin }) + '\\n');
if (args.includes('psql') && args.includes('-tA')) {
  if (process.env.LOOKUP_FAILS) process.exit(1);
  process.stdout.write(process.env.LOOKUP_COUNT + '\\n');
}
`;

// Stub curl: the backend is healthy, and the login after the seed step fails.
const CURL_STUB = `#!/usr/bin/env node
process.exit(process.argv.slice(2).some((a) => a.endsWith('/health')) ? 0 : 22);
`;

function runScript(name, { lookupCount = '0', lookupFails = false } = {}) {
  const dir = path.join(scratch, name);
  const bin = path.join(dir, 'bin');
  const aimRoot = path.join(dir, 'aim');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(aimRoot, { recursive: true });
  fs.writeFileSync(path.join(bin, 'docker'), DOCKER_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'curl'), CURL_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(aimRoot, 'docker-compose.quickstart.yml'), 'services: {}\n');
  const log = path.join(dir, 'calls.jsonl');

  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    AIM_ROOT: aimRoot,
    STUB_LOG: log,
    LOOKUP_COUNT: lookupCount,
  };
  if (lookupFails) env.LOOKUP_FAILS = '1';
  else delete env.LOOKUP_FAILS;

  const res = spawnSync('bash', [SCRIPT], {
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  const calls = fs.existsSync(log)
    ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    : [];
  return { res, calls, psql: calls.filter((c) => c.args.includes('psql')) };
}

const skip = process.platform === 'win32' ? 'needs bash and executable stubs' : false;

test('setup-aim-local.sh sends its SQL to psql on stdin and names no host /tmp path in a docker call', { skip }, () => {
  const { res, calls, psql } = runScript('seed');
  const output = `status ${res.status}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`;

  assert.match(res.stdout, /admin user seeded/, `the seed step did not complete\n${output}`);
  assert.equal(psql.length, 2, `expected a lookup and an insert, got:\n${JSON.stringify(psql, null, 2)}`);

  for (const call of calls) {
    assert.notEqual(call.args[0], 'cp', `docker cp copies a host file into the container: ${call.args.join(' ')}`);
    assert.ok(!call.args.some((a) => a.includes('/tmp/')), `a docker call names a /tmp path: ${call.args.join(' ')}`);
  }

  for (const call of psql) {
    const argv = call.args.join(' ');
    assert.ok(!call.args.includes('-c') && !call.args.includes('-f'), `SQL is not read from stdin: ${argv}`);
    assert.ok(call.stdin.trim().length > 0, `psql received no SQL on stdin: ${argv}`);
    assert.ok(call.args.includes(`email=${ADMIN_EMAIL}`), `the email is not passed as a psql variable: ${argv}`);
    assert.ok(call.stdin.includes(":'email'"), `the SQL does not read the email variable:\n${call.stdin}`);
    assert.ok(!call.stdin.includes(ADMIN_EMAIL), `the email is spliced into the SQL text:\n${call.stdin}`);
    assert.ok(!call.stdin.includes('$2a$'), `the password hash is spliced into the SQL text:\n${call.stdin}`);
  }

  const [lookup, insert] = psql;
  assert.match(lookup.stdin, /SELECT count\(\*\) FROM users/, `first psql call is not the lookup:\n${lookup.stdin}`);
  // Script input exits 0 on an SQL error unless ON_ERROR_STOP is set; the
  // lookup relies on a failing query falling back to a count of 0.
  assert.ok(lookup.args.includes('ON_ERROR_STOP=1'), `the lookup does not stop on SQL errors: ${lookup.args.join(' ')}`);
  assert.match(insert.stdin, /INSERT INTO users/, `second psql call is not the insert:\n${insert.stdin}`);
  assert.ok(insert.args.some((a) => /^pw_hash=\$2a\$12\$/.test(a)), `the hash is not passed as a psql variable: ${insert.args.join(' ')}`);
});

test('setup-aim-local.sh skips the insert when the admin already exists', { skip }, () => {
  const { res, psql } = runScript('present', { lookupCount: '1' });
  assert.match(res.stdout, /admin user already present/, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assert.equal(psql.length, 1, `expected only the lookup, got:\n${JSON.stringify(psql, null, 2)}`);
});

test('setup-aim-local.sh treats a failed admin lookup as no admin and seeds', { skip }, () => {
  const { res, psql } = runScript('lookup-fails', { lookupFails: true });
  assert.match(res.stdout, /admin user seeded/, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assert.equal(psql.length, 2, `expected a lookup and an insert, got:\n${JSON.stringify(psql, null, 2)}`);
});
