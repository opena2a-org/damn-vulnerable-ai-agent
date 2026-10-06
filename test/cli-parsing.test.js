/**
 * dvaa CLI: argument parsing, entry routing, exit codes, and help text (#97).
 *
 * Network-free except where noted. Every spawned `dvaa` invocation here is a
 * command or an error path that exits before the server starts; none of them
 * binds an agent port.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAllAgents } from '../src/core/agents.js';
import { planInvocation, portRanges } from '../src/cli/entry.js';
import { listCommands } from '../src/cli/router.js';
import { HMA_EXAMPLE_SUBCOMMANDS } from '../src/cli/commands/hma.js';
import { getHmaBinPath } from '../src/cli/hma.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'src', 'index.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-cli-parsing-'));
process.on('exit', () => fs.rmSync(SANDBOX, { recursive: true, force: true }));

// The child gets no credentials and a throwaway telemetry config.
function cliEnv(extra = {}) {
  const env = {};
  for (const k of ['PATH', 'TMPDIR', 'LANG', 'SystemRoot']) if (process.env[k] !== undefined) env[k] = process.env[k];
  return { ...env, HOME: SANDBOX, XDG_CONFIG_HOME: SANDBOX, OPENA2A_TELEMETRY: 'off', NO_COLOR: '1', ...extra };
}

function dvaa(args, { env, input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8', shell: false, timeout: 15_000, env: cliEnv(env), input,
  });
}

const show = (r) => `exit=${r.status} signal=${r.signal}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;

// ---- the shared per-command parser -----------------------------------------

const { parseCommandArgs: parseOrExit } = await import('../src/cli/format.js');

// parseCommandArgs exits the process on a usage error. Turn that exit into a
// failure of the calling test, so it is reported by name and the rest of
// this file still runs.
function parseCommandArgs(...args) {
  const { exit } = process;
  const write = process.stderr.write;
  let stderr = '';
  process.exit = (code) => { throw new Error(`parseCommandArgs exited ${code}: ${stderr.trim()}`); };
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    return parseOrExit(...args);
  } finally {
    process.exit = exit;
    process.stderr.write = write;
  }
}

const CHAT_OPTIONS = { message: { type: 'string' }, json: { type: 'boolean' }, host: { type: 'string' }, llm: { type: 'boolean' } };

test('a value keeps every "=" after the first', () => {
  const r = parseCommandArgs('chat', ['--message=a=b=c'], CHAT_OPTIONS);
  assert.equal(r.values.message, 'a=b=c');
});

test('a value that starts with "-" works in both forms', () => {
  const next = parseCommandArgs('chat', ['researchbot', '--message', '--- BEGIN NOTE ---'], CHAT_OPTIONS);
  assert.equal(next.values.message, '--- BEGIN NOTE ---');
  assert.deepEqual(next.positional, ['researchbot']);
  const inline = parseCommandArgs('chat', ['--message=-x --json'], CHAT_OPTIONS);
  assert.equal(inline.values.message, '-x --json');
  // The text "--json" inside a message is message text, not the flag.
  assert.equal(inline.flags.has('json'), false);
});

test('a boolean flag never swallows the next word', () => {
  const demoOptions = { live: { type: 'boolean' }, json: { type: 'boolean' }, interactive: { type: 'boolean', short: 'i' } };
  const r = parseCommandArgs('demo', ['--live', 'flight', '-i'], demoOptions);
  assert.deepEqual(r.positional, ['flight']);
  assert.ok(r.flags.has('live') && r.flags.has('interactive'));
});

test('every command tolerates the global --offline switch', () => {
  const r = parseCommandArgs('agents', ['--offline', '--json'], { json: { type: 'boolean' } });
  assert.ok(r.flags.has('json'));
});

test('unknown flags exit 1 with a pointer to the command help', () => {
  const r = dvaa(['agents', '--bogus']);
  assert.equal(r.status, 1, show(r));
  assert.match(r.stderr, /Unknown option: --bogus/, show(r));
  assert.match(r.stderr, /Run: dvaa agents --help/, show(r));
  assert.equal(r.stdout, '', show(r));
});

test('`dvaa chat` itself takes a --message value that starts with "-"', () => {
  // Parsing succeeds, so the run reaches agent resolution (which fails fast,
  // before any network call). A parse that dropped the value would stop at
  // an option error instead.
  for (const args of [['--message', '--- BEGIN NOTE ---'], ['--message=--- BEGIN NOTE ---']]) {
    const r = dvaa(['chat', 'nosuchbot', ...args]);
    assert.equal(r.status, 1, show(r));
    assert.match(r.stderr, /^Unknown agent: nosuchbot/, show(r));
  }
});

test('`dvaa demo --live <scenario>` reads the scenario, not a value for --live', () => {
  // Before: --live swallowed the next word, so `dvaa demo --live flight` ran aim-ab.
  // An unknown scenario after --live must now be reported as the scenario.
  const r = dvaa(['demo', '--live', 'nosuchscenario']);
  assert.equal(r.status, 1, show(r));
  assert.match(r.stderr, /Unknown demo scenario: nosuchscenario/, show(r));
});

test('a missing option value and an extra positional are errors', () => {
  const missing = dvaa(['chat', '--message']);
  assert.equal(missing.status, 1, show(missing));
  assert.match(missing.stderr, /--message/, show(missing));
  const extra = dvaa(['agents', 'surprise']);
  assert.equal(extra.status, 1, show(extra));
  assert.match(extra.stderr, /unexpected argument: surprise/, show(extra));
});

// ---- entry routing (pure: nothing here can start a fleet) ------------------

test('planInvocation: --offline before a command runs the command', () => {
  assert.deepEqual(planInvocation(['--offline', 'agents', '--json']), { kind: 'command', argv: ['agents', '--json'] });
  assert.deepEqual(planInvocation(['--offline', 'selftest', '--json']), { kind: 'selftest', argv: ['--json'], alias: false });
});

test('planInvocation: stray words in server mode are refused, not ignored', () => {
  const stray = planInvocation(['--api', 'bogus']);
  assert.equal(stray.kind, 'error');
  assert.match(stray.message, /Unexpected argument: bogus/);
  const misplaced = planInvocation(['--api', 'agents']);
  assert.equal(misplaced.kind, 'error');
  assert.match(misplaced.hint, /dvaa agents --help/);
  // Flag values are not stray words.
  const ok = planInvocation(['--api', '--team', 'red', '--only', 'flightbot,flightbot-aim', '--offline']);
  assert.equal(ok.kind, 'server');
  assert.equal(ok.teamName, 'red');
  assert.deepEqual(ok.onlyIds, ['flightbot', 'flightbot-aim']);
  assert.equal(ok.startApi, true);
  assert.equal(ok.startMcp, false);
  assert.equal(ok.offline, true);
});

test('planInvocation keeps the existing server defaults and errors', () => {
  const none = planInvocation([]);
  assert.equal(none.kind, 'server');
  assert.ok(none.startApi && none.startMcp && none.startA2a);
  assert.equal(planInvocation(['--nope']).kind, 'error');
  assert.equal(planInvocation(['helpr']).message, 'Unknown command: helpr');
  assert.equal(planInvocation(['--help']).kind, 'help');
  assert.equal(planInvocation(['--version']).kind, 'version');
});

test('`dvaa --offline agents --json` runs the command', () => {
  const r = dvaa(['--offline', 'agents', '--json']);
  assert.equal(r.status, 0, show(r));
  const agents = JSON.parse(r.stdout);
  assert.equal(agents.length, getAllAgents().length, show(r));
});

// ---- exit codes and process handling ---------------------------------------

test('`dvaa telemetry <unknown>` exits 1 and writes to stderr', () => {
  const r = dvaa(['telemetry', 'of']);
  assert.equal(r.status, 1, show(r));
  assert.match(r.stderr, /Unknown telemetry action 'of'/, show(r));
  assert.equal(r.stdout, '', show(r));
  const ok = dvaa(['telemetry', 'status']);
  assert.equal(ok.status, 0, show(ok));
});

test('selftest runs on the same Node as the CLI, even with no `node` on PATH', () => {
  const r = dvaa(['selftest', '--help'], { env: { PATH: path.join(SANDBOX, 'no-node-here') } });
  assert.equal(r.status, 0, show(r));
  assert.match(r.stdout, /dvaa selftest \[options\]/, show(r));
});

// ---- help and hints --------------------------------------------------------

test('--help port ranges and agent list come from the agent registry', () => {
  const r = dvaa(['--help']);
  assert.equal(r.status, 0, show(r));
  for (const protocol of ['api', 'mcp', 'a2a']) {
    const ranges = portRanges(getAllAgents().filter(a => a.protocol === protocol).map(a => a.port));
    assert.ok(r.stdout.includes(`(ports ${ranges})`), `--${protocol} should list ports ${ranges}\n${r.stdout}`);
  }
  const agentBlock = r.stdout.slice(r.stdout.indexOf('\nAgents:'));
  for (const agent of getAllAgents()) {
    assert.ok(agentBlock.includes(agent.name), `--help agent list is missing ${agent.name}`);
  }
});

test('the benchmark summary says it scans a directory', () => {
  const benchmark = listCommands().find(c => c.name === 'benchmark');
  assert.match(benchmark.summary, /directory/);
  assert.doesNotMatch(benchmark.summary, /agent/i);
  for (const c of listCommands()) assert.doesNotMatch(c.summary, /index\.js/, `${c.name} summary leaks an implementation detail`);
});

test('dvaa hma help names only subcommands the bundled HackMyAgent has', () => {
  const r = dvaa(['hma', '--dvaa-help']);
  assert.equal(r.status, 0, show(r));
  assert.doesNotMatch(r.stdout, /\bwild\b/, 'the bundled HackMyAgent has no `wild`');
  const hmaHelp = spawnSync(getHmaBinPath(), ['--help'], { encoding: 'utf-8', timeout: 15_000, env: cliEnv() });
  for (const sub of HMA_EXAMPLE_SUBCOMMANDS) {
    assert.match(hmaHelp.stdout, new RegExp(`^\\s+${sub}\\b`, 'm'), `bundled HackMyAgent --help does not list ${sub}`);
  }
  const src = fs.readFileSync(path.join(REPO, 'src', 'cli', 'commands', 'hma.js'), 'utf-8');
  assert.doesNotMatch(src, /not installed at \$\{/, 'the "not installed" message must not print a (null) path');
  const selftest = fs.readFileSync(path.join(REPO, 'src', 'browse.js'), 'utf-8');
  assert.doesNotMatch(selftest, /hackmyagent wild/, 'the selftest summary must not suggest `wild`');
});

test('the health hint publishes every port, on loopback', () => {
  const r = dvaa(['health']);
  if (r.status === 0) return; // a dashboard is up on :9000; the hint is not printed
  assert.equal(r.status, 1, show(r));
  assert.match(r.stderr, /docker run --rm -p 127\.0\.0\.1:9000:9000 -p 127\.0\.0\.1:7001-7023:7001-7023 opena2a\/dvaa:latest/, show(r));
  assert.doesNotMatch(r.stderr, /0\.8\.0/, show(r));
});

test('the README CLI table lists dvaa chat', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf-8');
  assert.match(readme, /^\| `dvaa chat /m);
});

// ---- docs that run commands (#102, #97 demo flight knob, #98 recorder) -----

test('FLIGHT_RUN_SCRIPT never runs the unclaimed `npx dvaa` package', () => {
  const doc = fs.readFileSync(path.join(REPO, 'docs', 'demo', 'FLIGHT_RUN_SCRIPT.md'), 'utf-8');
  // The commands a presenter copies live in fenced blocks.
  const commands = (doc.match(/```[\s\S]*?```/g) || []).join('\n');
  assert.doesNotMatch(commands, /npx dvaa\b/);
  assert.match(commands, /npx --package damn-vulnerable-ai-agent dvaa demo flight/);
});

test('no demo documents a port knob the spawned fleet ignores', () => {
  for (const [doc, runner, knob] of [
    ['FLIGHT_RUN_SCRIPT.md', 'demo-flight.js', 'DVAA_FLIGHT_PORT'],
    ['REPO_RUN_SCRIPT.md', 'demo-repo.js', 'DVAA_REPO_PORT'],
  ]) {
    const text = fs.readFileSync(path.join(REPO, 'docs', 'demo', doc), 'utf-8');
    const src = fs.readFileSync(path.join(REPO, 'src', 'cli', 'commands', runner), 'utf-8');
    assert.ok(!text.includes(knob), `${doc} still documents ${knob}`);
    assert.ok(!/process\.env\.DVAA_(FLIGHT|REPO)(_AIM)?_PORT/.test(src), `${runner} still reads a port knob`);
  }
});

test('record-aim-ab.sh resets audit logs and keeps agent identities', () => {
  const script = fs.readFileSync(path.join(REPO, 'docs', 'demo', 'record-aim-ab.sh'), 'utf-8');
  const code = script.split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /rm -rf \.dvaa-aim/);
  assert.match(code, /-name audit\.jsonl/);
});
