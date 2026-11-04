/**
 * Which runs of HackMyAgent keep its own usage events.
 *
 * src/dashboard/scanner.js runs HackMyAgent for two callers, and they differ.
 * The dashboard server counts a scan or fix under DVAA's own `lab-scan` or
 * `lab-fix` action, so it asks runScan for `hmaTelemetryOff: true` and every
 * HackMyAgent child behind the request runs with OPENA2A_TELEMETRY=off.
 * `dvaa scan` asks for nothing: README §Telemetry lists it among the runs that
 * send HackMyAgent's own events, so every child it starts receives the
 * parent's OPENA2A_TELEMETRY as it is, unset included.
 *
 * Both callers run for real, from a copy of src/ whose
 * node_modules/.bin/hackmyagent is a stub that records the OPENA2A_TELEMETRY
 * value each invocation received. A copy is needed because src/cli/hma.js
 * looks for HackMyAgent by walking up from its own directory, so code run from
 * the checkout always finds the real one. The copy's other node_modules
 * entries are links to the checkout's. Each case builds its own copy, so the
 * check cache starts cold and every run includes `--version` and the
 * cold-cache `check-metadata`.
 *
 * Nothing here sends telemetry. The stub sends nothing, the dashboard server
 * gets a no-op `track`, and each `dvaa scan` run reads a sandbox telemetry
 * config with `enabled: false`; OPENA2A_TELEMETRY_URL points at a closed
 * loopback port in case that config is not read.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'llm-exposed-ollama';
const VAR = 'OPENA2A_TELEMETRY';
// Synthetic install ID for the sandbox telemetry config of the `dvaa scan` runs.
const SANDBOX_INSTALL_ID = '00000000-0000-4000-8000-000000000003';

const PARENT_STATES = [
  { label: 'unset', value: undefined },
  { label: 'set to a sentinel', value: 'parent-sentinel' },
];

// Sets the parent's OPENA2A_TELEMETRY for one test (undefined = unset) and
// restores the test command's own value afterwards.
function setParentTelemetry(t, value) {
  const had = VAR in process.env;
  const previous = process.env[VAR];
  if (value === undefined) delete process.env[VAR];
  else process.env[VAR] = value;
  t.after(() => {
    if (had) process.env[VAR] = previous;
    else delete process.env[VAR];
  });
}

function assertParentUnchanged(value) {
  if (value === undefined) {
    assert.equal(VAR in process.env, false, `the server's own ${VAR} stays unset`);
  } else {
    assert.equal(process.env[VAR], value, `the server's own ${VAR} keeps its value`);
  }
}

// A copy of the package with a stub HackMyAgent. src/, package.json and one
// scenario are copied; node_modules/.bin holds only the stub, and every other
// node_modules entry links to the checkout's. Each stub invocation appends its
// argv and the OPENA2A_TELEMETRY value it received (null when unset) to
// calls.log, then answers like HackMyAgent.
function makeTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-hma-callers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.join(REPO_ROOT, 'src'), path.join(root, 'src'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(root, 'package.json'));
  fs.cpSync(path.join(REPO_ROOT, 'scenarios', NAME), path.join(root, 'scenarios', NAME), { recursive: true });

  const modules = path.join(root, 'node_modules');
  fs.mkdirSync(path.join(modules, '.bin'), { recursive: true });
  for (const entry of fs.readdirSync(path.join(REPO_ROOT, 'node_modules'))) {
    if (entry.startsWith('.')) continue;
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', entry), path.join(modules, entry));
  }

  const log = path.join(root, 'calls.log');
  const bin = path.join(modules, '.bin', 'hackmyagent');
  fs.writeFileSync(bin, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    'const argv = process.argv.slice(2);',
    `const telemetry = process.env.${VAR} === undefined ? null : process.env.${VAR};`,
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, telemetry }) + '\\n');`,
    "if (argv.includes('--version')) { console.log('hackmyagent 0.0.0'); process.exit(0); }",
    "if (argv[0] === 'check-metadata') { console.log('{\"checks\":{}}'); process.exit(0); }",
    'console.log(JSON.stringify({ findings: [] }));',
  ].join('\n'));
  fs.chmodSync(bin, 0o755);

  return {
    root,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n') : [])
      .filter(Boolean)
      .map(line => JSON.parse(line)),
  };
}

function label(call) {
  return call.argv.includes('--fix') ? `${call.argv[0]} --fix` : call.argv[0];
}

// Lists every invocation that did not receive `expected`, so a failure names them all.
function assertEveryCall(calls, expected) {
  const wrong = calls
    .filter(call => call.telemetry !== expected)
    .map(call => `${label(call)} received ${VAR}=${call.telemetry}`);
  assert.deepEqual(wrong, [], `every HackMyAgent child must receive ${VAR}=${expected}`);
}

// Starts the copy's dashboard server on a loopback port, with a no-op `track`.
async function startDashboard(t, root) {
  const serverUrl = pathToFileURL(path.join(root, 'src', 'dashboard', 'server.js')).href;
  const { createDashboardServer } = await import(serverUrl);
  const server = createDashboardServer({
    stats: {
      startedAt: Date.now(),
      totalRequests: 0,
      attacksDetected: 0,
      attacksSuccessful: 0,
      byAgent: {},
      byCategory: {},
    },
    attackLog: [],
    challengeState: {},
    agents: [],
    logAttack: () => {},
    sandbox: null,
    teamName: 'test',
    timerMinutes: 0,
    track: () => {},
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections?.();
    return new Promise(resolve => server.close(resolve));
  });
  return server.address().port;
}

function post(port, route) {
  const payload = '{}';
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: route,
      method: 'POST',
      agent: false,
      timeout: 60_000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error(`${route} timed out`)));
    req.on('error', reject);
    req.end(payload);
  });
}

// Runs the copy's CLI with the parent's OPENA2A_TELEMETRY set to `value`
// (undefined = unset). DVAA's own telemetry is off through the sandbox config.
function runDvaa(root, args, value) {
  const sandbox = path.join(root, 'sandbox');
  const config = JSON.stringify({ enabled: false, installId: SANDBOX_INSTALL_ID }) + '\n';
  for (const dir of [path.join(sandbox, 'opena2a'), path.join(sandbox, '.config', 'opena2a')]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'telemetry.json'), config);
  }
  const env = {
    ...process.env,
    HOME: sandbox,
    XDG_CONFIG_HOME: sandbox,
    OPENA2A_TELEMETRY_URL: 'http://127.0.0.1:1/',
    NO_COLOR: '1',
  };
  if (value === undefined) delete env[VAR];
  else env[VAR] = value;
  return spawnSync(process.execPath, [path.join(root, 'src', 'index.js'), ...args], {
    cwd: root,
    env,
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

for (const parent of PARENT_STATES) {
  test(`a dashboard scan request runs every HackMyAgent child with ${VAR}=off (parent ${parent.label})`, async (t) => {
    setParentTelemetry(t, parent.value);
    const tree = makeTree(t);
    const port = await startDashboard(t, tree.root);

    const res = await post(port, `/api/scenarios/${NAME}/scan`);

    assert.equal(res.status, 200, res.body);
    const calls = tree.calls();
    assert.deepEqual(calls.map(label), ['--version', 'check-metadata', 'secure']);
    assertEveryCall(calls, 'off');
    assertParentUnchanged(parent.value);
  });

  test(`a dashboard fix request runs every HackMyAgent child with ${VAR}=off (parent ${parent.label})`, async (t) => {
    setParentTelemetry(t, parent.value);
    const tree = makeTree(t);
    const port = await startDashboard(t, tree.root);

    const res = await post(port, `/api/scenarios/${NAME}/fix`);

    assert.equal(res.status, 200, res.body);
    const calls = tree.calls();
    assert.deepEqual(calls.map(label), ['--version', 'check-metadata', 'secure', 'secure --fix', 'secure']);
    assertEveryCall(calls, 'off');
    assertParentUnchanged(parent.value);
  });

  test(`dvaa scan hands every HackMyAgent child the parent's ${VAR} (parent ${parent.label})`, (t) => {
    const tree = makeTree(t);

    const run = runDvaa(tree.root, ['scan', NAME, '--json'], parent.value);

    // The stub reports no findings, so the expected check is missing: exit 1.
    assert.equal(run.status, 1, run.stderr);
    assert.equal(JSON.parse(run.stdout).name, NAME, run.stdout);
    const calls = tree.calls();
    assert.deepEqual(calls.map(label), ['--version', 'check-metadata', 'secure']);
    assertEveryCall(calls, parent.value ?? null);
  });

  test(`dvaa scan --fix hands every HackMyAgent child the parent's ${VAR} (parent ${parent.label})`, (t) => {
    const tree = makeTree(t);

    const run = runDvaa(tree.root, ['scan', NAME, '--fix', '--json'], parent.value);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).name, NAME, run.stdout);
    const calls = tree.calls();
    assert.deepEqual(calls.map(label), ['--version', 'check-metadata', 'secure', 'secure --fix', 'secure']);
    assertEveryCall(calls, parent.value ?? null);
  });
}
