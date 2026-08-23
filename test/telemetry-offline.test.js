/**
 * Regression test for the offline/telemetry guarantee.
 *
 * `@opena2a/telemetry` snapshots the opt-out config inside tele.init(), so the
 * OPENA2A_TELEMETRY env var must be set BEFORE init runs (src/index.js, at
 * process entry) - setting it later (a flag parsed after init, or inside the
 * demo command) is too late and telemetry still fires. This test pins that:
 * the demo command and --offline produce ZERO telemetry posts, while a normal
 * trackable command still posts (proving the mock harness actually observes them).
 *
 * Spawns the real CLI with OPENA2A_TELEMETRY_URL pointed at a local mock so no
 * real telemetry endpoint is contacted, and with the per-machine telemetry
 * config redirected into a throwaway sandbox so the suite measures DVAA's
 * opt-out logic rather than whatever the operator's own machine has persisted.
 * See runWithTelemetryMock for why that isolation is load-bearing rather than
 * tidiness: without it, on an opted-out machine the two suppression assertions
 * below are vacuous - they assert a count that cannot be anything else - while
 * the control and the auto-opt-out case fail outright.
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.js');

// Base env that starts from "telemetry on by default" (no inherited opt-out).
function baseEnv(overrides = {}) {
  const e = { ...process.env };
  delete e.OPENA2A_TELEMETRY;
  delete e.OPENA2A_TELEMETRY_DEBUG;
  return { ...e, ...overrides };
}

// A synthetic install id, seeded into the sandbox config before every run. It is
// the isolation WITNESS: the SDK stamps `install_id` onto each event from the
// config it actually loaded, so a posted event carrying this value proves the
// spawned CLI READ its opt-out decision from the sandbox rather than from the
// machine. Proving it merely WROTE there is weaker and breaks for the wrong
// reason - the SDK's lazy config write is a privacy wart we would want removed,
// and a witness coupled to it would report an isolation failure that had not
// happened.
const SEED_INSTALL_ID = '00000000-0000-4000-8000-000000000001';

// `$XDG_CONFIG_HOME/opena2a/` is where the SDK looks when XDG is set;
// `$HOME/.config/opena2a/` is where it looks when it is not. Both are seeded so
// the sandbox survives that path moving.
function seedSandboxConfig(root) {
  const cfg = JSON.stringify({ enabled: true, installId: SEED_INSTALL_ID }) + '\n';
  for (const dir of [path.join(root, 'opena2a'), path.join(root, '.config', 'opena2a')]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'telemetry.json'), cfg, { mode: 0o600 });
  }
}

function runWithTelemetryMock(args, env) {
  return new Promise((resolve) => {
    let hits = 0;
    // Isolate the per-machine telemetry config for the duration of this run.
    //
    // Without this the suite measured the OPERATOR'S machine, not DVAA. The SDK
    // resolves `enabled` as `!envOptOut && fileEnabled` against a persisted
    // config file, so on any machine where someone has run `telemetry off` - or
    // where any other OpenA2A tool sharing that file has - `fileEnabled` is
    // false, every spawn below posts nothing, and `hits` is structurally 0. The
    // two `hits === 0` assertions then pass for a reason that has nothing to do
    // with the offline guarantee they exist to verify, and the control is the
    // thing correctly reporting it.
    //
    // Measured on this repo at c3dd6c7: with the ambient config visible, 0 of 4
    // mutations of the opt-out path in src/index.js produced any new failure -
    // including moving the whole opt-out to after tele.init(), which is the
    // exact defect this file's header comment says it pins. With the config
    // isolated, 4 of 4 are caught.
    //
    // HOME is redirected alongside XDG_CONFIG_HOME so the sandbox survives the
    // SDK's config path moving between the two.
    const sandbox = mkdtempSync(path.join(tmpdir(), 'dvaa-tele-'));
    seedSandboxConfig(sandbox);
    const installIds = [];
    const srv = http.createServer((req, res) => {
      hits++;
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        try { installIds.push(JSON.parse(body).install_id); } catch { installIds.push(null); }
        res.end('{}');
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const child = spawn('node', [CLI, ...args], {
        env: {
          ...env,
          OPENA2A_TELEMETRY_URL: `http://127.0.0.1:${port}/ev`,
          XDG_CONFIG_HOME: sandbox,
          HOME: sandbox,
        },
        stdio: 'ignore',
      });
      child.on('close', (code) => {
        // The CLI flushes telemetry before exit; a short grace covers the socket.
        setTimeout(() => {
          srv.close();
          rmSync(sandbox, { recursive: true, force: true });
          resolve({ hits, code, installIds });
        }, 300);
      });
    });
  });
}

// Every run that posts asserts its own isolation. A future SDK that stopped
// honouring these variables would otherwise silently return the suite to
// measuring ambient machine state, and that regression has two faces: on an
// opted-out machine the control goes red, but on a machine that has never
// opted out it looks exactly like four passing tests. The seeded id catches
// both: a machine id is a UUIDv4, either random or derived from a sha256 of
// host facts, so it will not collide with the fixed synthetic value below.
//
// A run that posts nothing carries no id to check, so the suppression cases
// inherit this through the shared helper rather than witnessing it themselves.
// That is what the control test is for, and why deleting it would be the end
// of the measurement rather than the loss of one case.
async function run(args, env) {
  const r = await runWithTelemetryMock(args, env);
  if (r.installIds.length > 0) {
    // Never interpolate the observed id: on an un-isolated run it is the real
    // per-machine install id, and this output can land in a public CI log.
    assert.ok(
      r.installIds.every((id) => id === SEED_INSTALL_ID),
      'a telemetry event carried an install id that was not the seeded one, so the '
        + 'spawned CLI loaded config from outside the sandbox: this run measured the '
        + "operator's machine, not DVAA",
    );
  }
  return r;
}

test('control: a trackable command posts telemetry when enabled (harness sanity)', async () => {
  const { hits } = await run(['agents'], baseEnv({ OPENA2A_TELEMETRY: 'on' }));
  assert.ok(hits >= 1, `expected >=1 telemetry post when enabled, got ${hits}`);
});

test('demo command is offline-by-default: no telemetry post', async () => {
  const { hits } = await run(['demo', '--help'], baseEnv());
  assert.equal(hits, 0, `demo must not post telemetry, got ${hits}`);
});

test('--offline suppresses telemetry on a trackable command', async () => {
  const { hits } = await run(['agents', '--offline'], baseEnv());
  assert.equal(hits, 0, `--offline must suppress telemetry, got ${hits}`);
});

// Named for what it actually proves. It used to be called "operator can opt back
// in for the demo via explicit OPENA2A_TELEMETRY=on", and that is not true: the
// SDK's envOptOut() matches only off|0|false|no, so the env var can disable
// telemetry and can never enable it. An operator whose persisted config says
// enabled:false cannot opt back in with it, whatever this file is called.
//
// What the case does verify is real and worth keeping - the `=== undefined`
// guard in src/index.js, which makes `demo` skip its automatic opt-out when the
// operator has set the variable explicitly. The telemetry that then flows is the
// default-on config doing so, not the env var switching anything on.
// Tracked as opena2a-org/opena2a#293.
test('an explicit OPENA2A_TELEMETRY value suppresses the demo auto-opt-out', async () => {
  const { hits } = await run(['demo', '--help'], baseEnv({ OPENA2A_TELEMETRY: 'on' }));
  assert.ok(hits >= 1, `demo must not force telemetry off when the operator set it, got ${hits}`);
});
