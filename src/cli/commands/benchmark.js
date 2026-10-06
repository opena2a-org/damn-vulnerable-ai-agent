/**
 * dvaa benchmark [path] - run the OASB-1 compliance benchmark against a
 * directory (default: the caller's current directory). It scans files on
 * disk, not a running agent. Delegates to
 * `hackmyagent secure <path> --benchmark oasb-1 --level <L>`.
 */

import { runHmaInherit } from '../hma.js';
import { parseCommandArgs } from '../format.js';

export default async function run(argv) {
  const { positional, flags, values } = parseCommandArgs('benchmark', argv, {
    level: { type: 'string' },
    json: { type: 'boolean' },
  }, { maxPositionals: 1 });
  if (flags.has('help')) {
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
