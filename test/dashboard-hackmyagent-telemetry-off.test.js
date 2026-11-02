/**
 * Every HackMyAgent process the dashboard starts runs with
 * OPENA2A_TELEMETRY=off in its own environment.
 *
 * DVAA records a dashboard scan or fix as its own `lab-scan` or `lab-fix`
 * event. src/dashboard/scanner.js starts HackMyAgent to do that work (the
 * scan, the fix, the cold-cache `check-metadata` and `--version`) and gives
 * each of those children the switch in the child's environment only. The
 * server's own process.env must not change, so DVAA's own events still follow
 * the user's setting.
 *
 * A stub binary records the OPENA2A_TELEMETRY value each invocation received.
 * Each case imports its own instance of scanner.js, so the in-memory check
 * registry starts empty, and gives the stub its own scratch directory, so the
 * on-disk cache starts empty too: every scan and fix case includes the
 * cold-cache `check-metadata` run. Each case sets the parent's variable
 * (unset, or a sentinel value), so the test command's own setting never
 * reaches the stub. The control runs the stub directly with the parent's
 * environment, to show that the stub reports what it receives.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'llm-exposed-ollama';
const EXPECTED = ['LLM-001'];
const VAR = 'OPENA2A_TELEMETRY';
const STUB_VERSION = '0.0.0';

const PARENT_STATES = [
  { label: 'unset', value: undefined },
  { label: 'set to a sentinel', value: 'parent-sentinel' },
];

let instances = 0;
// A separate module instance of scanner.js: its in-memory check registry
// starts empty, so the run spawns --version and check-metadata again.
function freshScanner() {
  instances += 1;
  return import(`../src/dashboard/scanner.js?instance=${instances}`);
}

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

// Stub layout mirrors a real install: <root>/node_modules/.bin/hackmyagent,
// so scanner.js keeps the check cache at <root>/.hackmyagent-cache. Each
// invocation appends its argv and the OPENA2A_TELEMETRY value it received
// (null when unset) to calls.log, then answers like HackMyAgent.
function makeStub(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-stub-hma-env-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binDir = path.join(root, 'node_modules', '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  const log = path.join(root, 'calls.log');
  const bin = path.join(binDir, 'hackmyagent');
  fs.writeFileSync(bin, [
    '#!/usr/bin/env node',
    "const fs = require('fs');",
    'const argv = process.argv.slice(2);',
    `const telemetry = process.env.${VAR} === undefined ? null : process.env.${VAR};`,
    `fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, telemetry }) + '\\n');`,
    `if (argv.includes('--version')) { console.log('hackmyagent ${STUB_VERSION}'); process.exit(0); }`,
    "if (argv[0] === 'check-metadata') { console.log('{\"checks\":{}}'); process.exit(0); }",
    'console.log(JSON.stringify({ findings: [] }));',
  ].join('\n'));
  fs.chmodSync(bin, 0o755);

  const pkgRoot = path.join(root, 'pkg');
  fs.cpSync(path.join(REPO_ROOT, 'scenarios', NAME, 'vulnerable'),
    path.join(pkgRoot, 'scenarios', NAME, 'vulnerable'), { recursive: true });

  return {
    bin,
    pkgRoot,
    cacheFile: path.join(root, '.hackmyagent-cache', `check-metadata-v${STUB_VERSION}.json`),
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n') : [])
      .filter(Boolean)
      .map(line => JSON.parse(line)),
  };
}

function label(call) {
  return call.argv.includes('--fix') ? `${call.argv[0]} --fix` : call.argv[0];
}

// Lists every invocation that did not receive off, so a failure names them all.
function assertEveryCallOff(calls) {
  const notOff = calls
    .filter(call => call.telemetry !== 'off')
    .map(call => `${label(call)} received ${VAR}=${call.telemetry}`);
  assert.deepEqual(notOff, [], `every HackMyAgent child must receive ${VAR}=off`);
}

for (const parent of PARENT_STATES) {
  test(`a dashboard scan runs --version, the cold-cache check-metadata and the scan with ${VAR}=off (parent ${parent.label})`, async (t) => {
    setParentTelemetry(t, parent.value);
    const stub = makeStub(t);
    assert.equal(fs.existsSync(stub.cacheFile), false, 'the check cache starts cold');
    const { runScan } = await freshScanner();

    await runScan({ pkgRoot: stub.pkgRoot, name: NAME, expected: EXPECTED, hmaBin: stub.bin });

    const calls = stub.calls();
    assert.deepEqual(calls.map(label), ['--version', 'check-metadata', 'secure']);
    assertEveryCallOff(calls);
    assert.ok(fs.existsSync(stub.cacheFile), 'the cold-cache path ran and wrote the cache');
    assertParentUnchanged(parent.value);
  });

  test(`a dashboard fix runs the baseline scan, the --fix run and the re-scan with ${VAR}=off (parent ${parent.label})`, async (t) => {
    setParentTelemetry(t, parent.value);
    const stub = makeStub(t);
    const { runScan } = await freshScanner();

    await runScan({ pkgRoot: stub.pkgRoot, name: NAME, expected: EXPECTED, fix: true, hmaBin: stub.bin });

    const calls = stub.calls();
    assert.deepEqual(calls.map(label), ['--version', 'check-metadata', 'secure', 'secure --fix', 'secure']);
    assertEveryCallOff(calls);
    assertParentUnchanged(parent.value);
  });

  test(`control: the stub run directly with the parent's environment does not receive off (parent ${parent.label})`, (t) => {
    setParentTelemetry(t, parent.value);
    const stub = makeStub(t);

    const run = spawnSync(stub.bin, ['--version'], { encoding: 'utf-8' });

    assert.equal(run.status, 0, run.stderr);
    const calls = stub.calls();
    assert.equal(calls.length, 1, JSON.stringify(calls));
    assert.equal(calls[0].telemetry, parent.value ?? null);
    assert.notEqual(calls[0].telemetry, 'off');
  });
}
