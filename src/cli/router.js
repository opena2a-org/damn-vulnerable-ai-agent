/**
 * dvaa CLI dispatcher.
 *
 * Checks argv[0] against a known subcommand table. If matched, the command
 * module owns the process (runs, exits). Otherwise returns false and the
 * caller falls through to the server-start path in src/index.js.
 */

import runAgents from './commands/agents.js';
import runHealth from './commands/health.js';
import runAttack from './commands/attack.js';
import runLogs from './commands/logs.js';
import runScan from './commands/scan.js';
import runBenchmark from './commands/benchmark.js';
import runHma from './commands/hma.js';

const COMMANDS = {
  agents:    { run: runAgents,    summary: 'List DVAA agents with port, protocol, and security level.' },
  health:    { run: runHealth,    summary: 'Ping the DVAA dashboard and report fleet status.' },
  attack:    { run: runAttack,    summary: 'Run HackMyAgent attacks against a DVAA agent (or URL).' },
  logs:      { run: runLogs,      summary: 'Show recent attack log entries; --follow to tail.' },
  scan:      { run: runScan,      summary: 'Run HackMyAgent against a scenario fixture; --fix to remediate.' },
  benchmark: { run: runBenchmark, summary: 'Run OASB-1 benchmark against a DVAA agent.' },
  hma:       { run: runHma,       summary: 'Pass-through to the bundled HackMyAgent CLI.' },
  browse:    { run: null,         summary: 'Send DVAA agents to browse a target site (handled in index.js).' },
};

export function isSubcommand(name) {
  return Object.prototype.hasOwnProperty.call(COMMANDS, name) && COMMANDS[name].run != null;
}

export function listCommands() {
  return Object.entries(COMMANDS)
    .filter(([, cmd]) => cmd.summary)
    .map(([name, cmd]) => ({ name, summary: cmd.summary }));
}

export async function dispatch(argv) {
  const [name, ...rest] = argv;
  const cmd = COMMANDS[name];
  if (!cmd || !cmd.run) return false;
  const exitCode = await cmd.run(rest);
  process.exit(exitCode ?? 0);
}
