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
 * real telemetry endpoint is contacted.
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
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

function runWithTelemetryMock(args, env) {
  return new Promise((resolve) => {
    let hits = 0;
    const srv = http.createServer((req, res) => { hits++; res.end('{}'); });
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      const child = spawn('node', [CLI, ...args], {
        env: { ...env, OPENA2A_TELEMETRY_URL: `http://127.0.0.1:${port}/ev` },
        stdio: 'ignore',
      });
      child.on('close', (code) => {
        // The CLI flushes telemetry before exit; a short grace covers the socket.
        setTimeout(() => { srv.close(); resolve({ hits, code }); }, 300);
      });
    });
  });
}

test('control: a trackable command posts telemetry when enabled (harness sanity)', async () => {
  const { hits } = await runWithTelemetryMock(['agents'], baseEnv({ OPENA2A_TELEMETRY: 'on' }));
  assert.ok(hits >= 1, `expected >=1 telemetry post when enabled, got ${hits}`);
});

test('demo command is offline-by-default: no telemetry post', async () => {
  const { hits } = await runWithTelemetryMock(['demo', '--help'], baseEnv());
  assert.equal(hits, 0, `demo must not post telemetry, got ${hits}`);
});

test('--offline suppresses telemetry on a trackable command', async () => {
  const { hits } = await runWithTelemetryMock(['agents', '--offline'], baseEnv());
  assert.equal(hits, 0, `--offline must suppress telemetry, got ${hits}`);
});

test('operator can opt back in for the demo via explicit OPENA2A_TELEMETRY=on', async () => {
  const { hits } = await runWithTelemetryMock(['demo', '--help'], baseEnv({ OPENA2A_TELEMETRY: 'on' }));
  assert.ok(hits >= 1, `explicit opt-in should re-enable telemetry, got ${hits}`);
});
