/**
 * Shared output helpers for the dvaa CLI.
 *
 * Every command accepts --json. Text mode is for humans; JSON mode is for
 * piping into jq/CI. Formatters below keep both paths identical in content.
 */

export function isJsonMode(argv) {
  return argv.includes('--json');
}

export function emit(data, argv) {
  if (isJsonMode(argv)) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  // Human-readable — callers pass a string or an array of lines.
  if (Array.isArray(data)) {
    process.stdout.write(data.join('\n') + '\n');
  } else if (typeof data === 'string') {
    process.stdout.write(data + '\n');
  } else {
    // Fallback: dump as JSON so we never silently drop output.
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }
}

export function fail(msg, exitCode = 1) {
  process.stderr.write(msg + '\n');
  process.exit(exitCode);
}

/**
 * Render an array of row objects as a column-aligned table.
 * rows: [{ col1, col2, ... }]
 * cols: [{ key, header }]  ordering + labels
 */
export function tableRows(rows, cols) {
  if (rows.length === 0) return [];
  const widths = cols.map(c => Math.max(
    String(c.header).length,
    ...rows.map(r => String(r[c.key] ?? '').length)
  ));
  const line = (vals) => vals.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
  const out = [];
  out.push(line(cols.map(c => c.header)));
  out.push(line(widths.map(w => '─'.repeat(w))));
  for (const r of rows) out.push(line(cols.map(c => r[c.key])));
  return out;
}

/**
 * Peel trailing flags (--json, --verbose, --follow, ...) from a positional arg.
 * Returns { positional, flags } so commands can quickly separate them.
 */
export function splitArgs(argv) {
  const positional = [];
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      // --key=value
      if (a.includes('=')) {
        const [k, v] = a.slice(2).split('=', 2);
        values[k] = v;
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        // --key value  (only peel if next token is not a flag)
        const next = argv[i + 1];
        // Heuristic: known boolean flags don't take a value.
        const booleans = new Set(['json', 'follow', 'verbose', 'help', 'fix', 'list', 'all']);
        if (booleans.has(a.slice(2))) {
          flags.add(a.slice(2));
        } else {
          values[a.slice(2)] = next;
          i++;
        }
      } else {
        flags.add(a.slice(2));
      }
    } else if (a.startsWith('-')) {
      flags.add(a.slice(1));
    } else {
      positional.push(a);
    }
  }
  return { positional, flags, values };
}
