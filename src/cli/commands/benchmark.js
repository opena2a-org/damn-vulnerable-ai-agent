/**
 * dvaa benchmark — run OASB-1 compliance benchmark against a target.
 *
 * Default target: the caller's current directory. Pass --agent <name> to
 * resolve against a DVAA fleet member's code path, or --url <url> to scan a
 * different target. Delegates to `hackmyagent secure -b oasb-1 -l <L>`.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { runHmaInherit } from '../hma.js';
import { splitArgs } from '../format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '../../..');

export default async function run(argv) {
  const { positional, flags, values } = splitArgs(argv);
  if (flags.has('help') || flags.has('h')) {
    console.log(USAGE);
    return 0;
  }

  const level = (values.level || 'L1').toUpperCase();
  if (!['L1', 'L2', 'L3'].includes(level)) {
    process.stderr.write(`Invalid level "${level}". Use L1, L2, or L3.\n`);
    return 1;
  }

  const target = positional[0] || process.cwd();
  const hmaArgs = ['secure', target, '--benchmark', 'oasb-1', '--level', level];
  if (flags.has('json')) hmaArgs.push('--format', 'json');

  return runHmaInherit(hmaArgs);
}

const USAGE = `Usage: dvaa benchmark [path] [--level L1|L2|L3] [--json]

Run the OASB-1 infrastructure compliance benchmark against a target directory.

Arguments:
  path         Directory to scan (default: current directory)

Options:
  --level L    OASB-1 level: L1 (essential) | L2 (standard) | L3 (hardened).
               Default: L1.
  --json       Emit HMA's JSON format instead of human-readable output.
  --help       Show this message

Wraps: hackmyagent secure <path> --benchmark oasb-1 --level <L>`;
