/**
 * Boots the real dashboard server with the real @opena2a/telemetry, fires one
 * request at it, flushes, and exits.
 *
 * A child process on purpose: tele.init() snapshots the opt-out config exactly
 * once per process, so each case needs a fresh one. Used by
 * test/telemetry-server-optout.test.js.
 *
 * Usage: node server-telemetry-harness.mjs <METHOD> <ROUTE>
 */
import http from 'node:http';
import * as tele from '@opena2a/telemetry';
import { createDashboardServer } from '../../src/dashboard/server.js';

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
