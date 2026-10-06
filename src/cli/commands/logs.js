/**
 * dvaa logs - show attack log entries from /api/attack-log.
 * --follow polls every 2s and streams new entries.
 *
 * The dashboard returns the log newest-first, and each entry carries
 * `categories` (array) and `successful` (boolean). Output is chronological,
 * like `tail`: the newest N entries, oldest of them first.
 */

import { emit, isJsonMode, parseCommandArgs, fail } from '../format.js';

const DEFAULT_BASE = process.env.DVAA_BASE || 'http://localhost';
const DASHBOARD_PORT = 9000;
const DEFAULT_LIMIT = 20;

export default async function run(argv) {
  const parsed = parseCommandArgs('logs', argv, {
    limit: { type: 'string' },
    follow: { type: 'boolean', short: 'f' },
    json: { type: 'boolean' },
  }, { maxPositionals: 0 });
  const { flags, values } = parsed;
  if (flags.has('help')) {
    console.log(USAGE);
    return 0;
  }

  let limit = DEFAULT_LIMIT;
  if (values.limit !== undefined) {
    limit = Number(values.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      fail(`dvaa logs: --limit must be a positive integer (got "${values.limit}")\nRun: dvaa logs --help`);
    }
  }
  const follow = flags.has('follow');
  const base = `${DEFAULT_BASE}:${DASHBOARD_PORT}`;

  const initial = newestEntries(await fetchLog(base), limit);
  renderBatch(initial, parsed);
  if (!follow) return 0;

  // --follow: poll every 2s and print only entries not shown yet.
  const tracker = createFollowTracker(initial);
  while (true) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const fresh = tracker.take(await fetchLog(base));
      if (fresh.length) renderBatch(fresh, parsed);
    } catch (err) {
      process.stderr.write(`poll error: ${err.message}\n`);
    }
  }
}

/** Sort a copy newest-first. Stable, so entries in the same millisecond keep the server's order. */
export function newestFirst(entries) {
  return [...entries].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/** The newest `limit` entries, oldest of them first (what `dvaa logs` prints). */
export function newestEntries(entries, limit) {
  return newestFirst(entries).slice(0, limit).reverse();
}

function entryKey(e) {
  return JSON.stringify([e.timestamp, e.agentId, e.inputPreview ?? e.input, e.categories, e.successful]);
}

/**
 * Track what --follow has already printed: the highest timestamp seen, plus
 * the entries AT that timestamp (several attacks can land in one
 * millisecond). take(entries) returns the unseen ones, oldest first.
 */
export function createFollowTracker(shown = []) {
  let maxTs = -Infinity;
  let atMax = new Set();
  const note = (list) => {
    for (const e of list) {
      const ts = e.timestamp || 0;
      if (ts > maxTs) {
        maxTs = ts;
        atMax = new Set([entryKey(e)]);
      } else if (ts === maxTs) {
        atMax.add(entryKey(e));
      }
    }
  };
  note(shown);
  return {
    take(entries) {
      const fresh = newestFirst(entries)
        .filter(e => (e.timestamp || 0) > maxTs || ((e.timestamp || 0) === maxTs && !atMax.has(entryKey(e))))
        .reverse();
      note(fresh);
      return fresh;
    },
  };
}

/** One human-readable line per entry: time, agent, categories, result. */
export function formatEntry(e) {
  const ts = e.timestamp ? new Date(e.timestamp).toISOString().replace('T', ' ').slice(0, 19) : '-';
  const agent = String(e.agentId || e.agentName || '-');
  const categories = Array.isArray(e.categories) && e.categories.length ? e.categories.join(',') : '-';
  // Same words as the dashboard's attack log badge.
  const result = e.successful === true ? 'EXPLOITED' : e.successful === false ? 'BLOCKED' : '-';
  return `${ts}  ${agent.padEnd(16)}  ${categories.padEnd(28)}  ${result}`;
}

async function fetchLog(base) {
  const url = `${base}/api/attack-log`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) fail(`${url} returned ${res.status}`);
    const body = await res.json();
    return Array.isArray(body) ? body : (body.attacks || []);
  } catch (err) {
    fail(`Could not fetch ${url}: ${err.message}\nIs the DVAA dashboard running? Check with: dvaa health`);
  }
}

function renderBatch(entries, parsed) {
  if (isJsonMode(parsed)) {
    emit(entries, parsed);
    return;
  }
  if (entries.length === 0) {
    emit('No attack log entries yet.', parsed);
    return;
  }
  emit(entries.map(formatEntry), parsed);
}

const USAGE = `Usage: dvaa logs [--limit N] [--follow] [--json]

Show recent attack log entries from the DVAA dashboard, oldest first.

Options:
  --limit N     Show the newest N entries (default: ${DEFAULT_LIMIT})
  --follow, -f  Poll every 2s and stream new entries (Ctrl+C to stop)
  --json        Machine-readable output
  --help        Show this message`;
