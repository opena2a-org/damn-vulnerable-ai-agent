/**
 * Shared output helpers for the dvaa CLI.
 *
 * Every command accepts --json. Text mode is for humans; JSON mode is for
 * piping into jq/CI. Formatters below keep both paths identical in content.
 */

import { parseArgs } from 'node:util';

/**
 * True when JSON output was requested. Accepts either the raw argv array or
 * the result of parseCommandArgs(); prefer the parsed form, because in raw
 * argv a string option's value can itself be "--json" (`--message --json`).
 */
export function isJsonMode(argvOrParsed) {
  if (Array.isArray(argvOrParsed)) return argvOrParsed.includes('--json');
  return Boolean(argvOrParsed?.flags?.has('json'));
}

export function emit(data, argv) {
  if (isJsonMode(argv)) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    return;
  }
  // Human-readable - callers pass a string or an array of lines.
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

// Options every command parsed here accepts (`hma` passes its arguments to
// HackMyAgent unparsed). `--offline` is the global telemetry switch;
// src/index.js applies it before telemetry starts, so a command only has to
// tolerate it (`dvaa agents --offline`).
const COMMON_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  offline: { type: 'boolean' },
};

/**
 * Parse a subcommand's argv with util.parseArgs in strict mode.
 *
 *   command   - the subcommand name, used in the "Run: dvaa <cmd> --help" hint
 *   options   - util.parseArgs option specs: { name: { type, short? } }
 *   maxPositionals - how many positional arguments the command takes
 *
 * A declared string option always takes its value from the token after it,
 * even one that starts with "-": `--message "--- BEGIN"` and
 * `--message=--- BEGIN` are the same, and `--name=value` splits on the first
 * "=" only. Unknown options, a missing value, or an extra positional exit 1
 * with a pointer to the command's help.
 *
 * Returns { positional, flags, values }: `flags` is the Set of boolean options
 * that were given, `values` maps each given string option to its value.
 */
export function parseCommandArgs(command, argv, options = {}, { maxPositionals = Infinity } = {}) {
  const spec = { ...COMMON_OPTIONS, ...options };
  const takesValue = new Map();
  for (const [name, opt] of Object.entries(spec)) {
    if (opt.type !== 'string') continue;
    takesValue.set(`--${name}`, name);
    if (opt.short) takesValue.set(`-${opt.short}`, name);
  }
  // util.parseArgs rejects `--message "--- BEGIN"` as ambiguous in strict
  // mode. Join each string option with the token after it into the
  // unambiguous `--name=value` form first. Tokens after `--` are positionals.
  const args = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      args.push(...argv.slice(i));
      break;
    }
    const name = takesValue.get(token);
    if (name && i + 1 < argv.length) {
      args.push(`--${name}=${argv[i + 1]}`);
      i++;
    } else {
      args.push(token);
    }
  }

  let parsed;
  try {
    parsed = parseArgs({ args, options: spec, allowPositionals: true, strict: true });
  } catch (err) {
    const unknown = err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' && /'([^']+)'/.exec(err.message);
    const reason = unknown ? `Unknown option: ${unknown[1]}` : String(err.message).split('\n')[0];
    fail(`dvaa ${command}: ${reason}\nRun: dvaa ${command} --help`);
  }

  const positional = parsed.positionals;
  if (positional.length > maxPositionals && !parsed.values.help) {
    fail(`dvaa ${command}: unexpected argument: ${positional[maxPositionals]}\nRun: dvaa ${command} --help`);
  }
  const flags = new Set();
  const values = {};
  for (const [name, value] of Object.entries(parsed.values)) {
    if (spec[name]?.type === 'string') values[name] = value;
    else if (value === true) flags.add(name);
  }
  return { positional, flags, values };
}
