/**
 * The server path with the REAL SDK, not an injected stub.
 *
 * telemetry-server-path.test.js injects `track` to assert which routes count as
 * a user action. That proves the allowlist but says nothing about whether the
 * real thing honours the opt-out — and the server path is new ground for
 * telemetry, so "the existing opt-outs still work" is a claim that needs
 * proving rather than asserting. This boots the real dashboard with the real
 * @opena2a/telemetry against a mock endpoint and counts posts.
 *
 * Mirrors telemetry-offline.test.js, which does the same for the CLI path.
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

// Lives OUTSIDE test/ on purpose. Node's default glob is
// `**/test/**/*.?(c|m)js`, so a harness under test/ is executed as a test file —
// which ran it with its production defaults and posted a fabricated `command`
// event to the real Registry on every `npm test`, from CI and from laptops.
// See the guard at the top of the harness itself.
const HARNESS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'test-support',
  'server-telemetry-harness.mjs'
);

/**
 * Boot the real dashboard in a child process (so tele.init's one-shot config
 * snapshot is taken fresh per case), fire one request, count telemetry posts.
 */
function runServerCase({ env = {}, method = 'POST', route = '/api/agents/x/chat' } = {}) {
  return new Promise((resolve) => {
    let hits = 0;
    const mock = http.createServer((req, res) => {
      hits++;
      res.end('{}');
    });
    mock.listen(0, '127.0.0.1', () => {
      const telemetryPort = mock.address().port;
      // A throwaway HOME/XDG so a real install_id on this machine is never
      // touched and the run can't inherit a persisted opt-out.
      const home = mkdtempSync(path.join(tmpdir(), 'dvaa-telem-'));
      const childEnv = { ...process.env };
      delete childEnv.OPENA2A_TELEMETRY;
      delete childEnv.OPENA2A_TELEMETRY_DEBUG;

      const child = spawn(process.execPath, [HARNESS, method, route], {
        env: {
          ...childEnv,
          HOME: home,
          XDG_CONFIG_HOME: home,
          OPENA2A_TELEMETRY_URL: `http://127.0.0.1:${telemetryPort}/ev`,
          ...env,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => {
        // Telemetry is fire-and-forget; give the socket a moment to land.
        setTimeout(() => {
          mock.close();
          rmSync(home, { recursive: true, force: true });
          resolve({ hits, code, out });
        }, 400);
      });
    });
  });
}

test('control: a lab action on the server path posts telemetry (harness sanity)', async () => {
  // Without this the suppression assertions below could pass because the
  // harness observes nothing at all.
  const { hits, code, out } = await runServerCase();
  assert.equal(code, 0, `harness failed: ${out}`);
  assert.ok(hits >= 1, `expected a telemetry post, got ${hits}. Output: ${out}`);
});

test('OPENA2A_TELEMETRY=off suppresses the server path entirely', async () => {
  const { hits, code, out } = await runServerCase({ env: { OPENA2A_TELEMETRY: 'off' } });
  assert.equal(code, 0, `harness failed: ${out}`);
  assert.equal(hits, 0, `opted-out server posted ${hits} time(s)`);
});

test('the HEALTHCHECK route posts nothing even with telemetry fully enabled', async () => {
  // The end-to-end version of the allowlist guarantee: an idle container whose
  // only traffic is its own healthcheck must report zero.
  const { hits, code, out } = await runServerCase({ method: 'GET', route: '/stats' });
  assert.equal(code, 0, `harness failed: ${out}`);
  assert.equal(hits, 0, `/stats posted ${hits} time(s) — an unopened container would look engaged`);
});
