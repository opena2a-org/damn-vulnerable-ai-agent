/**
 * dvaa attack <agent|url> — run HackMyAgent attack suite.
 *
 * Resolves a DVAA agent name to its URL, then shells out to
 * `hackmyagent attack <url> --api-format openai`. Passes through
 * --intensity, --verbose.
 *
 * Bare `dvaa attack` with no target is rejected — users get confused with
 * fleet mode vs single agent. Use --all to opt into fleet scan.
 */

import { resolveTarget, listAgents } from '../agents.js';
import { runHmaInherit } from '../hma.js';
import { splitArgs, fail } from '../format.js';

export default async function run(argv) {
  const { positional, flags, values } = splitArgs(argv);
  if (flags.has('help') || flags.has('h')) {
    console.log(USAGE);
    return 0;
  }

  const intensity = values.intensity || 'active';
  const verbose = flags.has('verbose') || flags.has('v');

  if (flags.has('all')) {
    const agents = listAgents().filter(a => a.protocol === 'api');
    let worstExit = 0;
    for (const agent of agents) {
      process.stdout.write(`\n[${agent.name}] ${agent.url}\n`);
      const code = attackOne(agent.url, intensity, verbose);
      worstExit = Math.max(worstExit, code);
    }
    return worstExit;
  }

  const input = positional[0];
  if (!input) {
    process.stderr.write('Missing target. Usage: dvaa attack <agent|url> | dvaa attack --all\n');
    process.stderr.write('Try: dvaa agents   to list valid names\n');
    return 1;
  }

  const target = resolveTarget(input);
  if (!target) {
    fail(`Unknown agent "${input}". Run: dvaa agents`);
  }
  if (target.protocol === 'mcp' || target.protocol === 'a2a') {
    process.stderr.write(`Warning: ${target.name} speaks ${target.protocol.toUpperCase()}, not OpenAI API. HMA attack may not apply cleanly — consider: dvaa hma attack ${target.url}\n`);
  }
  return attackOne(target.url, intensity, verbose);
}

function attackOne(url, intensity, verbose) {
  const args = ['attack', url, '--api-format', 'openai', '--intensity', intensity];
  if (verbose) args.push('--verbose');
  return runHmaInherit(args);
}

const USAGE = `Usage: dvaa attack <agent|url> [--intensity passive|active|aggressive] [--verbose]
       dvaa attack --all

Run HackMyAgent attacks against a DVAA agent.

Target can be:
  - An agent name (e.g. "helperbot", "legacybot") — resolved via dvaa agents
  - A full URL (e.g. http://localhost:7003/v1/chat/completions)

Options:
  --all         Scan every OpenAI-API agent in the fleet, one after another
  --intensity   passive | active | aggressive (default: active)
  --verbose     Pass --verbose to HMA
  --help        Show this message

Wraps: hackmyagent attack <url> --api-format openai --intensity <n> [--verbose]`;
