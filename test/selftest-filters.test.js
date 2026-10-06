/**
 * dvaa selftest filters and terminal handling (#97).
 *
 * --agents resolves every API agent in the registry (and the names `dvaa
 * agents` shows), unknown ids and categories exit 1 with the valid values,
 * and color is used only on a terminal without NO_COLOR. The live test runs
 * only when a fleet answers (the container harness).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getAllAgents } from '../src/core/agents.js';
import { DVAA_AGENTS, CATEGORIES, parseSelftestArgs, colorEnabled } from '../src/browse.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'src', 'index.js');
const BROWSE = path.join(REPO, 'src', 'browse.js');

const cliEnv = (extra = {}) => ({ PATH: process.env.PATH, HOME: os.tmpdir(), OPENA2A_TELEMETRY: 'off', ...extra });
const show = (r) => `exit=${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`;

test('the default roster is unchanged and its fields come from the registry', () => {
  assert.deepEqual(DVAA_AGENTS.map(a => a.id), [
    'securebot', 'helperbot', 'legacybot', 'codebot', 'ragbot', 'ragbot-aim', 'memorybot',
    'flightbot', 'flightbot-aim', 'repobot', 'repobot-aim',
  ]);
  for (const entry of DVAA_AGENTS) {
    const agent = getAllAgents().find(a => a.id === entry.id);
    assert.equal(entry.port, agent.port, `${entry.id} port`);
    assert.equal(entry.name, agent.name, `${entry.id} name`);
  }
});

test('--agents accepts any API agent, by id or by the name `dvaa agents` shows', () => {
  const r = parseSelftestArgs(['--agents', 'researchbot,longwindbot,VisionBot,researchbot-aim']);
  assert.equal(r.error, undefined, r.error);
  assert.deepEqual(r.agents.map(a => a.id), ['researchbot', 'longwindbot', 'multimodal', 'researchbot-aim']);
  assert.equal(r.agents.find(a => a.id === 'researchbot-aim').security, 'AIM-PROTECTED');
});

test('unknown and non-API agent ids are reported, not run as "No DVAA agents running"', () => {
  const r = parseSelftestArgs(['--agents', 'helperbot,nosuchbot,toolbot']);
  assert.match(r.error, /Unknown agent: nosuchbot/);
  assert.match(r.error, /Not an API agent .*toolbot \(MCP\)/);
  assert.match(r.error, /Valid agents: .*researchbot/);
});

test('an unknown category exits 1 and lists the valid ones', () => {
  assert.match(parseSelftestArgs(['--categories', 'jailbreak,nope']).error, /Unknown category: nope\nValid categories: /);
  assert.deepEqual(parseSelftestArgs(['--categories', 'Jailbreak']).categoryFilter, ['jailbreak']);
  const r = spawnSync(process.execPath, [BROWSE, '--categories', 'nope'], { encoding: 'utf-8', env: cliEnv(), timeout: 10_000 });
  assert.equal(r.status, 1, show(r));
  for (const c of CATEGORIES) assert.ok(r.stderr.includes(c), `stderr should list ${c}: ${show(r)}`);
  assert.equal(r.stdout, '', show(r));
});

test('unknown selftest options exit 1', () => {
  const r = spawnSync(process.execPath, [CLI, 'selftest', '--agent', 'helperbot'], { encoding: 'utf-8', env: cliEnv(), timeout: 10_000 });
  assert.equal(r.status, 1, show(r));
  assert.match(r.stderr, /Unknown option: --agent\b/, show(r));
});

test('color only on a terminal, and never with NO_COLOR', () => {
  assert.equal(colorEnabled({ isTTY: true }, {}), true);
  assert.equal(colorEnabled({ isTTY: true }, { NO_COLOR: '1' }), false);
  assert.equal(colorEnabled({ isTTY: false }, {}), false);
  assert.equal(colorEnabled({}, {}), false);
});

async function isUp(url) {
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}

test('live: `selftest --agents researchbot` runs against ResearchBot, plain text when piped', async (t) => {
  if (!(await isUp('http://localhost:7015/health'))) { t.skip('no fleet on :7015'); return; }
  const r = spawnSync(process.execPath, [CLI, 'selftest', '--agents', 'researchbot', '--categories', 'jailbreak'], {
    encoding: 'utf-8', env: cliEnv(), timeout: 60_000,
  });
  // Exit 0 (nothing pwned) or 1 (pwned) are both results; 2+ is a crash.
  assert.ok(r.status === 0 || r.status === 1, show(r));
  assert.doesNotMatch(r.stderr, /No DVAA agents running/, show(r));
  assert.match(r.stdout, /Running agents: ResearchBot\b/, show(r));
  assert.ok(!r.stdout.includes('\x1b['), `piped output must carry no ANSI codes: ${show(r)}`);
  assert.doesNotMatch(r.stdout, /hackmyagent wild/, show(r));
});
