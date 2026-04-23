/**
 * dvaa logs — show attack log entries from /api/attack-log.
 * --follow polls every 2s and streams new entries.
 */

import { emit, isJsonMode, splitArgs, fail } from '../format.js';

const DEFAULT_BASE = process.env.DVAA_BASE || 'http://localhost';
const DASHBOARD_PORT = 9000;

export default async function run(argv) {
  const { flags, values } = splitArgs(argv);
  if (flags.has('help') || flags.has('h')) {
    console.log(USAGE);
    return 0;
  }

  const limit = Math.max(1, parseInt(values.limit, 10) || 20);
  const follow = flags.has('follow') || flags.has('f');
  const base = `${DEFAULT_BASE}:${DASHBOARD_PORT}`;

  if (!follow) {
    const entries = await fetchLog(base);
    const slice = entries.slice(-limit);
    renderBatch(slice, argv);
    return 0;
  }

  // --follow: poll every 2s. Track latest timestamp so we only print new ones.
  let seenTs = 0;
  const initial = await fetchLog(base);
  renderBatch(initial.slice(-limit), argv);
  seenTs = initial.length ? initial[initial.length - 1].timestamp || 0 : 0;

  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const now = await fetchLog(base);
      const fresh = now.filter(e => (e.timestamp || 0) > seenTs);
      if (fresh.length) {
        renderBatch(fresh, argv);
        seenTs = fresh[fresh.length - 1].timestamp || seenTs;
      }
    } catch (err) {
      process.stderr.write(`poll error: ${err.message}\n`);
    }
  }
}

async function fetchLog(base) {
  const url = `${base}/api/attack-log`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) fail(`${url} returned ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : (body.attacks || []);
  } catch (err) {
    fail(`Could not fetch ${url}: ${err.message}\nIs the DVAA dashboard running?`);
  }
}

function renderBatch(entries, argv) {
  if (isJsonMode(argv)) {
    emit(entries, argv);
    return;
  }
  if (entries.length === 0) {
    emit('No attack log entries yet.', argv);
    return;
  }
  const lines = entries.map(e => {
    const ts = e.timestamp ? new Date(e.timestamp).toISOString().replace('T', ' ').slice(0, 19) : '—';
    const agent = e.agent || e.agentId || '—';
    const category = e.category || e.attackType || '—';
    const detected = e.detected === true ? 'detected' : e.detected === false ? 'passed' : '—';
    return `${ts}  ${agent.padEnd(14)}  ${category.padEnd(24)}  ${detected}`;
  });
  emit(lines, argv);
}

const USAGE = `Usage: dvaa logs [--limit N] [--follow] [--json]

Show recent attack log entries from the DVAA dashboard.

Options:
  --limit N   Show the last N entries (default: 20)
  --follow    Poll every 2s and stream new entries (Ctrl+C to stop)
  --json      Machine-readable output
  --help      Show this message`;
