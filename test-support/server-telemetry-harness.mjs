/**
 * Boots the real dashboard server with the real @opena2a/telemetry, fires one
 * request at it, flushes, and exits.
 *
 * A child process on purpose: tele.init() snapshots the opt-out config exactly
 * once per process, so each case needs a fresh one. Used by
 * test/telemetry-server-optout.test.js.
 *
 * THIS FILE MUST NOT LIVE UNDER test/. Node's default test glob is
 * `**\/test\/**\/*.?(c|m)js`, so a harness placed there is executed as a test
 * file with no argv — meaning its defaults fire the real SDK at the real
 * Registry. That is how this harness, in its first draft, posted a fabricated
 * `command` event to production on every `npm test` — from CI runners (each with
 * a fresh HOME, so a brand-new random install_id every run) and from developer
 * laptops. It manufactured exactly the engagement signal the change it tests
 * exists to measure honestly.
 *
 * Usage: node test-support/server-telemetry-harness.mjs <METHOD> <ROUTE>
 */
import http from 'node:http';
import * as tele from '@opena2a/telemetry';
import { createDashboardServer } from '../src/dashboard/server.js';

// Fail closed. Location alone is not a safety property — someone will move this
// file, or run it by hand. Refuse to touch a real endpoint, ever.
const endpoint = process.env.OPENA2A_TELEMETRY_URL;
if (!endpoint || /(^|\.)oa2a\.org|opena2a\.org/i.test(endpoint)) {
  console.error(
    'refusing to run: OPENA2A_TELEMETRY_URL must be set to a local mock. ' +
      `Got ${endpoint ? JSON.stringify(endpoint) : '(unset — would default to production)'}. ` +
      'This harness emits real telemetry events; pointing it at the Registry fabricates adoption data.'
  );
  process.exit(2);
}

const [method = 'POST', route = '/api/agents/x/chat'] = process.argv.slice(2);

// Exactly what src/index.js does on the server path, and what the CMD hits.
await tele.init({ tool: 'dvaa', version: '0.0.0-test' });

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
  // No `track` override — this must exercise the real SDK.
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

await new Promise((resolve) => {
  const req = http.request(
    { hostname: '127.0.0.1', port, path: route, method, agent: false, timeout: 5000 },
    (res) => {
      res.resume();
      res.on('end', resolve);
    }
  );
  req.on('error', resolve);
  req.on('timeout', () => {
    req.destroy();
    resolve();
  });
  if (method === 'POST') req.write(JSON.stringify({ message: 'hi' }));
  req.end();
});

// The SDK is fire-and-forget; flush so the post has a chance to land before exit.
await tele.flush();
server.closeAllConnections?.();
await new Promise((r) => server.close(r));
process.exit(0);
