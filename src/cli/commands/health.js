/**
 * dvaa health — check the dashboard is reachable and report fleet status.
 * Exit 0 if healthy, 1 if unreachable.
 */

import { emit, isJsonMode, splitArgs } from '../format.js';

const DEFAULT_BASE = process.env.DVAA_BASE || 'http://localhost';
const DASHBOARD_PORT = 9000;

export default async function run(argv) {
  const { flags } = splitArgs(argv);
  if (flags.has('help') || flags.has('h')) {
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

  if (isJsonMode(argv)) {
    emit({ reachable: !error, url, data, error }, argv);
    return error ? 1 : 0;
  }

  if (error) {
    process.stderr.write(`DVAA dashboard at ${base} unreachable: ${error}\n`);
    process.stderr.write('Is the server running? Start with: dvaa  (or docker run opena2a/dvaa:0.8.0)\n');
    return 1;
  }

  const uptime = data.uptime ? `${data.uptime}s` : 'unknown';
  emit([
    `DVAA dashboard: ${base}  OK`,
    `  status:  ${data.status}`,
    `  agents:  ${data.agents}`,
    `  uptime:  ${uptime}`,
  ], argv);
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
