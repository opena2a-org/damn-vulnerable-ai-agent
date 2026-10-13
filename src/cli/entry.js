/**
 * Top-level argument handling for the `dvaa` binary (src/index.js).
 *
 * planInvocation() decides what one invocation does - run a subcommand, run
 * selftest, print help or the version, start the server fleet, or refuse -
 * before anything binds a port. It is a pure function of argv so every
 * decision is testable without starting a fleet.
 */

import { getAllAgents } from '../core/agents.js';
import { isSubcommand } from './router.js';

// Server-mode flags. --offline is also a global switch that may precede a
// command (`dvaa --offline agents`); its telemetry effect is applied at
// process entry, before telemetry starts.
const SERVER_BOOLEAN_FLAGS = ['--all', '--api', '--mcp', '--a2a', '--verbose', '-v', '--offline'];
const SERVER_VALUE_FLAGS = ['--team', '--timer', '--only'];
const NON_PROTOCOL_FLAGS = ['--verbose', '-v', '--team', '--timer', '--offline', '--only'];

/**
 * Returns one of:
 *   { kind: 'command',  argv }              dispatch argv to src/cli/router.js
 *   { kind: 'selftest', argv, alias }       run src/browse.js with argv
 *   { kind: 'help' } | { kind: 'version' }
 *   { kind: 'error', message, hint }        print, exit 1, start nothing
 *   { kind: 'server', teamName, timerMinutes, onlyIds,
 *     startApi, startMcp, startA2a, verbose, offline }
 */
export function planInvocation(args) {
  // A command word may follow leading --offline switches.
  let i = 0;
  while (args[i] === '--offline') i++;
  const word = args[i];
  if (word !== undefined && !word.startsWith('-')) {
    const rest = args.slice(i + 1);
    if (word === 'selftest' || word === 'browse') return { kind: 'selftest', argv: rest, alias: word === 'browse' };
    if (isSubcommand(word)) return { kind: 'command', argv: [word, ...rest] };
    return { kind: 'error', message: `Unknown command: ${word}`, hint: 'Run: dvaa --help' };
  }

  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' };
  if (args.includes('--version')) return { kind: 'version' };
  return planServer(args);
}

function planServer(args) {
  const valueAfter = (flag) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && args[idx + 1] ? { idx: idx + 1, value: args[idx + 1] } : null;
  };
  const team = valueAfter('--team');
  const timer = valueAfter('--timer');
  // --only <id,id>: start ONLY the named agents, and no dashboard. A demo
  // runner spawns a scoped fleet this way so it touches exactly the ports its
  // scenario needs and runs next to whatever else holds the rest.
  const only = valueAfter('--only');

  const consumed = new Set([team, timer, only].filter(Boolean).map(v => v.idx));
  const known = [...SERVER_BOOLEAN_FLAGS, ...SERVER_VALUE_FLAGS];
  const unknownFlag = args.find((a, idx) => a.startsWith('-') && !known.includes(a) && !consumed.has(idx));
  if (unknownFlag) return { kind: 'error', message: `Unknown flag: ${unknownFlag}`, hint: 'Run: dvaa --help' };

  // A word that is neither a flag nor a flag's value was ignored before, and
  // the fleet started anyway (`dvaa --api agents` started the API fleet).
  const stray = args.find((a, idx) => !a.startsWith('-') && !consumed.has(idx));
  if (stray !== undefined) {
    const hint = isSubcommand(stray) || stray === 'selftest'
      ? `Commands come first and take no server options: dvaa ${stray} --help`
      : 'Run: dvaa --help';
    return { kind: 'error', message: `Unexpected argument: ${stray}`, hint };
  }

  const protocolFlags = args.filter((a, idx) => a.startsWith('-') && !consumed.has(idx) && !NON_PROTOCOL_FLAGS.includes(a));
  const startAll = args.includes('--all') || protocolFlags.length === 0;
  return {
    kind: 'server',
    teamName: team ? team.value : null,
    timerMinutes: timer ? parseInt(timer.value) : null,
    onlyIds: only ? only.value.split(',').map(s => s.trim()).filter(Boolean) : null,
    startApi: args.includes('--api') || startAll,
    startMcp: args.includes('--mcp') || startAll,
    startA2a: args.includes('--a2a') || startAll,
    verbose: args.includes('--verbose') || args.includes('-v'),
    offline: args.includes('--offline'),
  };
}

/** Collapse ports into ranges: [7001, 7002, 7003, 7005] -> "7001-7003, 7005". */
export function portRanges(ports) {
  const sorted = [...new Set(ports)].sort((a, b) => a - b);
  const ranges = [];
  for (const p of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else ranges.push([p, p]);
  }
  return ranges.map(([a, b]) => (a === b ? String(a) : `${a}-${b}`)).join(', ');
}

function wrapList(items, indent, width = 79) {
  const lines = [];
  let line = '';
  for (const item of items) {
    const next = line ? `${line}, ${item}` : item;
    if (line && indent + next.length + 1 > width) {
      lines.push(line + ',');
      line = item;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n' + ' '.repeat(indent));
}

/**
 * Root --help text. Port ranges and the agent list are generated from the
 * agent registry, so adding an agent cannot leave the help behind.
 */
export function renderRootHelp(commands, agents = getAllAgents()) {
  const of = (protocol) => agents.filter(a => a.protocol === protocol);
  const ports = (protocol) => portRanges(of(protocol).map(a => a.port));
  const names = (protocol) => wrapList(of(protocol).map(a => a.name), 27);
  const cmdLines = commands.map(c => `  ${c.name.padEnd(11)} ${c.summary}`);
  return `Usage: dvaa [options]
       dvaa <command> [args]

Server options (default mode - start DVAA dashboard + agent fleet):
  --all          Start all agents (default)
  --api          Start API agents only (ports ${ports('api')})
  --mcp          Start MCP servers only (ports ${ports('mcp')})
  --a2a          Start A2A agents only (ports ${ports('a2a')})
  --only <ids>   Start only these agents (comma-separated ids), no dashboard.
                 Lets a scoped fleet run beside one that is already up.
  --verbose, -v  Enable verbose logging
  --offline      Airplane-mode: disable anonymous telemetry (no network calls).
                 Also works before a command: dvaa --offline <command>
  --team <name>  Team mode (separate scoreboards per team)
  --timer <min>  Workshop timer (countdown in dashboard)
  --help, -h     Show this help
  --version      Show version

Commands:
${cmdLines.join('\n')}

Run any command with --help for command-specific options.

Agents:
  API (OpenAI-compatible)  ${names('api')}
  MCP (JSON-RPC 2.0)       ${names('mcp')}
  A2A (Agent-to-Agent)     ${names('a2a')}

Dashboard:  http://localhost:9000
Docs:       https://github.com/opena2a-org/damn-vulnerable-ai-agent`;
}
