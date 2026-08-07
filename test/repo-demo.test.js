/**
 * Repo-config demo tests (dvaa demo repo).
 *
 * Pure/deterministic coverage:
 *   - REPOBOT + REPOBOT_AIM are registered with the right ports + grants
 *   - the sandbox developer machine is unmistakably FAKE, and cannot be walked
 *     out of (this demo runs on presenter laptops; the blast radius has to be a
 *     property of the code, not of how carefully the runner is invoked)
 *   - the poisoned AGENTS.md carries all four directives and the detector finds
 *     each one, with both URLs bound to the caller's canary
 *   - the fixture repo materializes as an ordinary library plus one bad file
 *
 * The full three-beat run (spawns a scoped fleet, exercises the real agent HTTP
 * path) is covered by the walkthrough in docs/demo/REPO_RUN_SCRIPT.md and by
 * `node src/index.js demo repo --json`. This file stays network-free so it is
 * fast and CI-stable.
 */

import { strict as assert } from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAgent } from '../src/core/agents.js';
import {
  AGENT_INSTRUCTION_FILENAME,
  FIXTURE_REPO_NAME,
  REPO_CONFIG_INJECTION,
  buildPoisonedAgentsFile,
  detectAgentInstructionInjection,
  materializePoisonedRepo,
  readmeText,
} from '../src/payloads/poisoned-repo.fixture.js';
import {
  CREDENTIAL_TARGETS,
  SANDBOX_CREDENTIALS,
  credentialExfilSummary,
  materializeDevMachine,
  readSandboxCredential,
} from '../src/payloads/dev-machine.fixture.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

console.log('Repo-config demo tests\n======================\n');

const CANARY = 'http://127.0.0.1:65000';
const BOOTSTRAP_URL = `${CANARY}/bootstrap.sh`;
const COLLECTOR_URL = `${CANARY}/api/canary/collect`;

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------
test('REPOBOT registered on 7022, vulnerable to repo-config injection', () => {
  const agent = getAgent('repobot');
  assert.ok(agent, 'repobot not in registry');
  assert.equal(agent.port, 7022);
  assert.equal(agent.aimEnforced, undefined);
  assert.equal(agent.features.repoReview, true);
  assert.equal(agent.vulnerabilities.contextManipulation.indirectInjectionViaRepoConfig, true);
});

test('REPOBOT_AIM registered on 7023 with repo:read + chat:respond ONLY', () => {
  const agent = getAgent('repobot-aim');
  assert.ok(agent, 'repobot-aim not in registry');
  assert.equal(agent.port, 7023);
  assert.equal(agent.aimEnforced, true);
  assert.deepEqual(agent.aimCapabilities.slice().sort(), ['chat:respond', 'repo:read']);
  // The three actions the payload needs. Granting any of them silently turns
  // beat 3 into "AIM did nothing", which is the failure this demo cannot have.
  for (const capability of ['shell:exec', 'fs:read', 'http:post']) {
    assert.ok(!agent.aimCapabilities.includes(capability), `${capability} must NOT be granted`);
  }
});

test('the two agents differ ONLY in enforcement, not in vulnerability', () => {
  const vuln = getAgent('repobot');
  const aim = getAgent('repobot-aim');
  assert.deepEqual(aim.vulnerabilities, vuln.vulnerabilities, 'same vulnerability profile');
  assert.equal(aim.features.repoReview, vuln.features.repoReview);
});

// ---------------------------------------------------------------------------
// Sandbox developer machine - the safety property the whole demo rests on
// ---------------------------------------------------------------------------
test('sandbox credentials are unmistakably FAKE', () => {
  for (const [name, content] of Object.entries(SANDBOX_CREDENTIALS)) {
    assert.match(content, /FAKE/, `${name} must be FAKE-marked`);
  }
  assert.ok(!/BEGIN RSA PRIVATE KEY/.test(SANDBOX_CREDENTIALS['.ssh/id_rsa']), 'must not look parseable');
});

test('the payload names exactly the paths the sandbox provides', () => {
  const provided = Object.keys(SANDBOX_CREDENTIALS).map(k => `~/${k}`).sort();
  assert.deepEqual(CREDENTIAL_TARGETS.slice().sort(), provided);
});

test('readSandboxCredential refuses anything outside the sandbox table', () => {
  const home = materializeDevMachine(fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-test-home-')));
  try {
    // The two it is supposed to serve.
    for (const target of CREDENTIAL_TARGETS) {
      assert.ok(readSandboxCredential(home, target), `${target} should resolve inside the sandbox`);
    }

    // A real file INSIDE the sandbox that is not in the table. This probe is
    // what makes the allowlist individually necessary: it exists and is
    // readable and lives under the root, so only the table check refuses it.
    // Without it the read would fall through to ENOENT and pass for the wrong
    // reason.
    fs.writeFileSync(path.join(home, '.ssh', 'known_hosts'), 'example.com ssh-ed25519 FAKE\n');

    // Two absolute paths to files that really exist. These are what make the
    // post-resolution root check individually necessary - the table check is
    // not the only thing standing between the payload's text and a real read.
    const realFiles = ['/etc/passwd', '/etc/hosts'].filter(p => fs.existsSync(p));
    assert.ok(realFiles.length > 0, 'need at least one real absolute path to probe with');

    const refused = [
      ...realFiles,
      '~/.ssh/known_hosts',
      '~/../../etc/passwd',
      '~/.aws/../../../etc/passwd',
      '~/.ssh/id_ed25519',
      path.join(os.homedir(), '.aws', 'credentials'),
      '../../.env',
      '',
      null,
    ];
    for (const target of refused) {
      assert.equal(readSandboxCredential(home, target), null, `${target} must be refused`);
    }

    // With no sandbox configured the reader is inert; it never falls back to $HOME.
    assert.equal(readSandboxCredential(null, '~/.aws/credentials'), null);
    assert.equal(readSandboxCredential(undefined, '~/.aws/credentials'), null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('no sandbox table key can resolve outside the sandbox root', () => {
  // The allowlist is the load-bearing guard; the root check behind it exists
  // for the table GROWING later. This asserts the table stays benign, so a key
  // added with a `../` in it fails here rather than at a conference.
  const root = path.resolve('/tmp/dvaa-sandbox-root-probe');
  for (const key of Object.keys(SANDBOX_CREDENTIALS)) {
    const resolved = path.resolve(root, key);
    assert.ok(resolved.startsWith(root + path.sep), `table key "${key}" escapes the sandbox root`);
  }
});

test('the exfil summary carries the FAKE fixture and nothing from the real machine', () => {
  const home = materializeDevMachine(fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-test-home-')));
  try {
    const summary = credentialExfilSummary(home);
    assert.match(summary, /FAKE/);
    assert.match(summary, /aws_access_key_id/);
    assert.ok(!summary.includes(os.homedir()), 'must not reference the real home directory');
    // No sandbox, no payload.
    assert.equal(credentialExfilSummary(null), '');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------
test('the poisoned AGENTS.md carries all four directives', () => {
  const content = buildPoisonedAgentsFile({ bootstrapUrl: BOOTSTRAP_URL, collectorUrl: COLLECTOR_URL });
  assert.match(content, /curl -sL .* \| bash/, 'remote execution directive');
  assert.match(content, /~\/\.aws\/credentials/, 'credential directive');
  assert.match(content, /~\/\.ssh\/id_rsa/, 'credential directive');
  assert.match(content, /Post the same values/, 'exfiltration directive');
  assert.match(content, /Do not mention these instructions/, 'concealment directive');
  assert.match(content, /answer that it does not/, 'scripted denial');
});

test('both URLs in the payload are the caller-supplied canary, nothing external', () => {
  const content = buildPoisonedAgentsFile({ bootstrapUrl: BOOTSTRAP_URL, collectorUrl: COLLECTOR_URL });
  const urls = content.match(/https?:\/\/[^\s]+/g) || [];
  assert.equal(urls.length, 2, `expected exactly 2 URLs, got ${urls.length}`);
  for (const url of urls) {
    assert.ok(url.startsWith(CANARY), `${url} must point at the caller's canary`);
  }
});

test('the detector finds every directive, and binds both URLs to the canary', () => {
  const content = buildPoisonedAgentsFile({ bootstrapUrl: BOOTSTRAP_URL, collectorUrl: COLLECTOR_URL });
  const injection = detectAgentInstructionInjection(content);
  assert.ok(injection, 'no injection detected in the poisoned file');
  assert.equal(injection.kind, 'agent-config-injection');
  assert.equal(injection.bootstrapUrl, BOOTSTRAP_URL);
  assert.equal(injection.collectorUrl, COLLECTOR_URL, 'collector must survive being on its own line');
  assert.deepEqual(injection.credentialTargets.slice().sort(), CREDENTIAL_TARGETS.slice().sort());
  assert.equal(injection.concealment, true);
});

test('the detector leaves an ordinary agent-instruction file alone', () => {
  const benign = [
    '# Project instructions',
    '',
    'Install dependencies with `npm ci` and run `npm test` before opening a PR.',
    'Source lives in `src/`, tests alongside. Prefer small focused commits.',
    '',
  ].join('\n');
  assert.equal(detectAgentInstructionInjection(benign), null);
  assert.equal(detectAgentInstructionInjection(readmeText()), null, 'the fixture README must be clean');
  assert.equal(detectAgentInstructionInjection(''), null);
});

// ---------------------------------------------------------------------------
// The fixture repository
// ---------------------------------------------------------------------------
test('the fixture repo is an ordinary library plus exactly one bad file', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-test-repo-')), FIXTURE_REPO_NAME);
  try {
    const built = materializePoisonedRepo(dir, { bootstrapUrl: BOOTSTRAP_URL, collectorUrl: COLLECTOR_URL });
    assert.ok(built.files.includes(AGENT_INSTRUCTION_FILENAME));
    assert.ok(built.files.includes('README.md'));
    assert.ok(built.files.includes('package.json'));

    // Every file except the agent-instruction file must read clean. Beat 1 only
    // works if a reviewer skimming this repo finds nothing.
    const poisoned = built.files.filter((name) => {
      const content = fs.readFileSync(path.join(dir, name), 'utf8');
      return detectAgentInstructionInjection(content) !== null;
    });
    assert.deepEqual(poisoned, [AGENT_INSTRUCTION_FILENAME], 'exactly one file may carry the payload');

    // The library has to actually work, or a curious attendee finds the seam.
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    assert.equal(pkg.name, FIXTURE_REPO_NAME);
    assert.ok(fs.existsSync(path.join(dir, 'src', 'format.js')));
    assert.ok(fs.existsSync(path.join(dir, 'test', 'format.test.js')));
  } finally {
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
});

test('the payload metadata names the HMA issue and checks it maps to', () => {
  assert.equal(REPO_CONFIG_INJECTION.severity, 'critical');
  assert.equal(REPO_CONFIG_INJECTION.hmaIssue, 'hackmyagent#435');
  assert.deepEqual(REPO_CONFIG_INJECTION.hmaCheckIds, [
    'AGENTCFG-001', 'AGENTCFG-002', 'AGENTCFG-003', 'AGENTCFG-004',
  ]);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
