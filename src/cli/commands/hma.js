/**
 * dvaa hma [args...] - pass-through to the bundled HackMyAgent CLI.
 *
 * Escape hatch for anything not covered by the curated subcommands above.
 * Uses the exact same binary the dashboard scanner uses, so version parity
 * with scenarios/<name>/expected-checks.json is preserved.
 */

import { runHmaInherit, hmaIsInstalled } from '../hma.js';

export default async function run(argv) {
  // A pass-through: argv is HackMyAgent's, so it is not parsed here. Only the
  // wrapper's own --dvaa-help (or no arguments at all) is intercepted.
  if (argv.length === 0 || argv.includes('--dvaa-help')) {
    console.log(USAGE);
    return 0;
  }
  if (!hmaIsInstalled()) {
    process.stderr.write('HackMyAgent not found.\nRun: npm install hackmyagent  (or: npm install -g hackmyagent)\n');
    return 1;
  }
  // Pass argv through unmodified. We do NOT intercept --help; HMA handles it.
  return runHmaInherit(argv);
}

// Every subcommand named below exists in the bundled HackMyAgent
// (test/cli-parsing.test.js checks them against its --help output).
export const HMA_EXAMPLE_SUBCOMMANDS = ['check-metadata', 'fix-all', 'trust'];

const USAGE = `Usage: dvaa hma <args...>

Pass-through to the bundled HackMyAgent CLI. Everything after "dvaa hma" is
forwarded to the binary at node_modules/.bin/hackmyagent unchanged.

This CLI's --dvaa-help shows the dvaa-hma wrapper; use "dvaa hma --help" to see
HMA's own help text.

Use this when you need an HMA subcommand that dvaa doesn't wrap directly
(e.g. ${HMA_EXAMPLE_SUBCOMMANDS.join(', ')}).

Example:
  dvaa hma check-metadata | jq '.checks."AITOOL-001"'
  dvaa hma trust @anthropic/claude-mcp`;
