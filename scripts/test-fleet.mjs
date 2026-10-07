#!/usr/bin/env node
/**
 * Run tests against a live DVAA fleet: `npm run test:fleet`.
 *
 * `npm test` runs without a fleet, so every live test skips. This script
 * starts one (`node src/index.js --all`), waits until the dashboard and every
 * agent it lists accept connections, runs `node --test`, and stops the fleet
 * on pass, fail, error, SIGINT, SIGTERM or SIGHUP. Its exit code is the test
 * run's. A fleet outlives this script when a signal it does not handle ends
 * it: SIGKILL, which cannot be caught, or one such as SIGQUIT (Ctrl-\); see
 * the note at the 'exit' handler below.
 *
 *   npm run test:fleet                                # the files npm test runs
 *   npm run test:fleet -- test/fleet-smoke.test.js    # only the files named
 *
 * - The fleet gets the allowlisted environment from src/cli/fleet-env.js: no
 *   provider key or cloud credential from this shell reaches the deliberately
 *   vulnerable agents, so they give their deterministic simulated replies.
 *   Telemetry is off, and DVAA_HOST is not passed, so it listens on loopback.
 * - The fleet runs in a temporary working directory, so the scores and AIM
 *   state it writes (.dvaa/, .dvaa-aim/) never land in the checkout or mix
 *   with a learner's own lab state. The directory is removed afterwards.
 * - It refuses to start when the dashboard port or an agent port is already
 *   in use, rather than run the tests against a fleet someone else started.
 * - The tests run with telemetry off and without OPENAI_API_KEY,
 *   ANTHROPIC_API_KEY or DVAA_HOST, so none reaches a real provider and the
 *   loopback checks are not skipped as if the fleet were exposed on purpose.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllAgents } from '../src/core/agents.js';
import { fleetEnv } from '../src/cli/fleet-env.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOST = '127.0.0.1';
const DASHBOARD_PORT = 9000;
const READY_TIMEOUT_MS = 60_000;
const STOP_GRACE_MS = 5_000;
const LOG_TAIL_LINES = 40;
// A process group lets one signal reach the fleet and anything it spawns.
const GROUP = process.platform !== 'win32';

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const say = (msg) => console.error(`test:fleet: ${msg}`);

/** True when something accepts a TCP connection on HOST:port. */
function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port });
    const done = (open) => { sock.destroy(); resolve(open); };
    sock.setTimeout(1000, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

async function getJson(pathname) {
  const res = await fetch(`http://${HOST}:${DASHBOARD_PORT}${pathname}`, { signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`${pathname} answered ${res.status}`);
  return res.json();
}

// Same file set as the `test` script in package.json.
const DEFAULT_TESTS = ['test/*.test.js', 'src/**/*.test.js'];
const testArgs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_TESTS;

const ports = [DASHBOARD_PORT, ...getAllAgents().map(a => a.port)];
const busy = [];
for (const port of ports) {
  if (await portOpen(port)) busy.push(port);
}
if (busy.length > 0) {
  say(`port ${busy.join(', ')} already in use on ${HOST}. Stop the running fleet first; this script starts its own.`);
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-test-fleet-'));
const logTail = [];
let partial = '';
function record(chunk) {
  const lines = (partial + chunk).split('\n');
  partial = lines.pop();
  logTail.push(...lines);
  if (logTail.length > LOG_TAIL_LINES) logTail.splice(0, logTail.length - LOG_TAIL_LINES);
}

const fleet = spawn(process.execPath, [path.join(REPO, 'src', 'index.js'), '--all'], {
  cwd: workDir,
  env: fleetEnv({ OPENA2A_TELEMETRY: 'off' }),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: GROUP,
});
fleet.stdout.setEncoding('utf-8').on('data', record);
fleet.stderr.setEncoding('utf-8').on('data', record);
const fleetExit = new Promise(resolve => fleet.once('exit', (code, signal) => resolve(signal || code)));
let fleetGone = false;
fleetExit.then(() => { fleetGone = true; });

function signalFleet(sig) {
  if (fleetGone) return;
  try {
    if (GROUP) process.kill(-fleet.pid, sig);
    else fleet.kill(sig);
  } catch { /* already exited */ }
}

let stopping = null;
function stopFleet() {
  stopping ??= (async () => {
    signalFleet('SIGTERM');
    const timer = setTimeout(() => signalFleet('SIGKILL'), STOP_GRACE_MS);
    await fleetExit;
    clearTimeout(timer);
    fs.rmSync(workDir, { recursive: true, force: true });
  })();
  return stopping;
}

// Last resort if this process exits some other way (an uncaught error, a
// process.exit elsewhere): kill the fleet's process group. No handler runs
// when a signal this process does not handle ends it: SIGKILL, which cannot
// be caught, or one with no listener below, such as SIGQUIT (Ctrl-\),
// SIGUSR2, SIGALRM or SIGABRT. The fleet, in its own process group, then keeps
// running and its dvaa-test-fleet-* directory stays in the temp directory. The
// next run refuses to start because the ports are in use: stop that fleet with
// `kill <pid>`, using the pid that `lsof -iTCP:9000 -sTCP:LISTEN` prints, and
// remove the directory by hand.
process.on('exit', () => signalFleet('SIGKILL'));

let runner = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(sig, async () => {
    say(`${sig} received, stopping the fleet`);
    runner?.kill(sig);
    await stopFleet();
    process.exit(128 + os.constants.signals[sig]);
  });
}

/** Wait until the dashboard and every agent it lists accept connections. */
async function waitForFleet() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fleetGone) throw new Error(`the fleet exited (${await fleetExit}) before it was ready`);
    try {
      await getJson('/health');
      const agents = await getJson('/agents');
      const open = await Promise.all(agents.map(a => portOpen(a.port)));
      if (agents.length > 0 && open.every(Boolean)) return agents.length;
    } catch { /* not up yet */ }
    await delay(250);
  }
  throw new Error(`the fleet was not ready within ${READY_TIMEOUT_MS / 1000}s`);
}

function runTests() {
  const env = { ...process.env, OPENA2A_TELEMETRY: 'off' };
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'DVAA_HOST']) delete env[key];
  return new Promise((resolve) => {
    runner = spawn(process.execPath, ['--test', ...testArgs], { cwd: REPO, env, stdio: 'inherit' });
    runner.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    runner.once('error', (err) => { say(`could not start node --test: ${err.message}`); resolve(1); });
  });
}

let code = 1;
try {
  const count = await waitForFleet();
  say(`fleet ready: dashboard and ${count} agents on ${HOST}`);
  code = await runTests();
} catch (err) {
  say(err.message);
} finally {
  await stopFleet();
}

if (code !== 0) {
  if (partial) logTail.push(partial);
  say(`fleet log (last ${logTail.length} lines):\n${logTail.join('\n')}`);
}
process.exit(code);
