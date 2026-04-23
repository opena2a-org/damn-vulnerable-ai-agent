/**
 * dvaa hma [args...] — pass-through to the bundled HackMyAgent CLI.
 *
 * Escape hatch for anything not covered by the curated subcommands above.
 * Uses the exact same binary the dashboard scanner uses, so version parity
 * with scenarios/<name>/expected-checks.json is preserved.
 */

import { runHmaInherit, getHmaBinPath, hmaIsInstalled } from '../hma.js';
import { splitArgs } from '../format.js';

export default async function run(argv) {
  const { flags } = splitArgs(argv);
  if (argv.length === 0 || flags.has('dvaa-help')) {
    console.log(USAGE);
    return 0;
  }
  if (!hmaIsInstalled()) {
    process.stderr.write(`HackMyAgent not installed at ${getHmaBinPath()}.\nRun: npm install\n`);
    return 1;
  }
  // Pass argv through unmodified. We do NOT intercept --help; HMA handles it.
  return runHmaInherit(argv);
}

const USAGE = `Usage: dvaa hma <args...>

Pass-through to the bundled HackMyAgent CLI. Everything after "dvaa hma" is
forwarded to the binary at node_modules/.bin/hackmyagent unchanged.

This CLI's --help shows the dvaa-hma wrapper; use "dvaa hma --help" to see
HMA's own help text.

Use this when you need an HMA subcommand that dvaa doesn't wrap directly
(e.g. check-metadata, fix-all, trust, wild).

Example:
  dvaa hma check-metadata | jq '.checks."AITOOL-001"'
  dvaa hma trust @anthropic/claude-mcp
  dvaa hma wild https://agentpwn.com`;
