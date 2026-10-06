/**
 * dvaa health - check the dashboard is reachable and report fleet status.
 * Exit 0 if healthy, 1 if unreachable.
 */

import { emit, isJsonMode, parseCommandArgs } from '../format.js';

const DEFAULT_BASE = process.env.DVAA_BASE || 'http://localhost';
const DASHBOARD_PORT = 9000;

// Publishes the dashboard and every agent port, on loopback only. A bare
// `docker run` publishes nothing, so the old hint reached no agent at all.
export const DOCKER_RUN_HINT =
  'docker run --rm -p 127.0.0.1:9000:9000 -p 127.0.0.1:7001-7023:7001-7023 opena2a/dvaa:latest';

export default async function run(argv) {
  const parsed = parseCommandArgs('health', argv, { json: { type: 'boolean' } }, { maxPositionals: 0 });
  if (parsed.flags.has('help')) {
    console.log(USAGE);
    return 0;
  }

  const base = `${DEFAULT_BASE}:${DASHBOARD_PORT}`;
  const url = `${base}/health`;
  let data = null;
  let error = null;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    error = err.message || String(err);
  }

  if (isJsonMode(parsed)) {
    emit({ reachable: !error, url, data, error }, parsed);
    return error ? 1 : 0;
  }

  if (error) {
    process.stderr.write(`DVAA dashboard at ${base} unreachable: ${error}\n`);
    process.stderr.write(`Is the server running? Start it with: dvaa\n`);
    process.stderr.write(`  or with Docker: ${DOCKER_RUN_HINT}\n`);
    return 1;
  }

  const uptime = data.uptime ? `${data.uptime}s` : 'unknown';
  emit([
    `DVAA dashboard: ${base}  OK`,
    `  status:  ${data.status}`,
    `  agents:  ${data.agents}`,
    `  uptime:  ${uptime}`,
  ], parsed);
  return 0;
}

const USAGE = `Usage: dvaa health [--json]

Check the DVAA dashboard is reachable and report fleet status.

Exit codes:
  0   Dashboard reachable and healthy
  1   Unreachable or returned a non-OK status

Options:
  --json    Machine-readable output
  --help    Show this message`;
