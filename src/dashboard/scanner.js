/**
 * HMA scanner bridge.
 *
 * Shells out to node_modules/.bin/hackmyagent against a scenario's vulnerable/
 * fixture, parses the JSON output, and returns a structured result the UI can
 * render directly (fired, missing, diagnostic text per finding).
 *
 * Always invokes the bundled HMA (pinned in package.json), never a globally
 * installed one — keeps expected-checks.json in version-parity with the binary.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const SCAN_TIMEOUT_MS = 60_000;

// Lazy-loaded map of every check HMA knows about: checkId -> { name, category,
// severity, guidance, fix, attackClass }. Used to fill in detail for expected
// checks that didn't fire, so the UI can show "AITOOL-001 — Jupyter Notebook
// Publicly Accessible" instead of a bare ID.
let checkRegistryCache = null;

async function loadCheckRegistry(hmaBin) {
  if (checkRegistryCache !== null) return checkRegistryCache;
  try {
    const { stdout } = await spawnCapture(hmaBin, ['check-metadata'], 30_000);
    const parsed = JSON.parse(stdout);
    checkRegistryCache = parsed.checks || {};
  } catch {
    checkRegistryCache = {};
  }
  return checkRegistryCache;
}

/**
 * Run HMA against scenarios/<name>/vulnerable/ and return parsed results.
 *
 * @param {object}   opts
 * @param {string}   opts.pkgRoot    Absolute path to the DVAA package root.
 * @param {string}   opts.name       Scenario directory name (must already be validated by caller).
 * @param {string[]} opts.expected   Expected check IDs from scenario's expected-checks.json.
 * @param {boolean}  [opts.fix=false] Pass --fix to HMA (auto-remediate).
 * @returns {Promise<ScanResult>}
 */
export async function runScan({ pkgRoot, name, expected, fix = false }) {
  const hmaBin = path.join(pkgRoot, 'node_modules', '.bin', 'hackmyagent');
  const scenarioDir = path.join(pkgRoot, 'scenarios', name, 'vulnerable');

  if (!fs.existsSync(hmaBin)) {
    throw new Error('HMA binary not found at node_modules/.bin/hackmyagent. Run `npm install`.');
  }
  if (!fs.existsSync(scenarioDir)) {
    throw new Error(`Scenario has no vulnerable/ directory: ${name}`);
  }

  // Fix runs need a baseline to tell "fixed" apart from "never fired" — HMA
  // drops a check from findings entirely once it passes, so we can't infer fix
  // success from a single post-fix scan alone. One extra scan is cheap (<200ms).
  const started = Date.now();
  const registry = await loadCheckRegistry(hmaBin);
  const baseline = fix ? await runHma(hmaBin, scenarioDir, false) : null;
  const current = await runHma(hmaBin, scenarioDir, fix);
  const durationMs = Date.now() - started;

  const firedNow = findingIds(current.findings);
  const firedBefore = baseline ? findingIds(baseline.findings) : firedNow;

  const fired = expected.filter(id => firedNow.includes(id));
  const missing = expected.filter(id => !firedNow.includes(id));

  const expectedDetail = expected.map(id => {
    const nowFinding = current.findings.find(f => f && f.checkId === id && f.passed === false);
    if (nowFinding) {
      return detailFromFinding(nowFinding, 'fired');
    }
    // Not firing now. On a fix run, if it WAS firing before, call it "fixed".
    if (fix && firedBefore.includes(id)) {
      const baseFinding = baseline.findings.find(f => f && f.checkId === id && f.passed === false);
      return detailFromFinding(baseFinding, 'fixed');
    }
    // Never fired. Pull whatever metadata HMA has on this check.
    const meta = registry[id] || null;
    return {
      checkId: id,
      status: 'missing',
      name: meta?.name || id,
      severity: meta?.severity || null,
      category: meta?.category || null,
      guidance: meta?.guidance || '',
      diagnostic: diagnoseMissing(id, current.findings),
      inRegistry: !!meta,
    };
  });

  return {
    name,
    expected,
    fired,
    missing,
    expectedDetail,
    allFindingsCount: current.findings.length,
    durationMs,
    exitCode: current.exitCode,
    fix,
  };
}

async function runHma(hmaBin, scenarioDir, fix) {
  const args = ['secure', scenarioDir, '--format', 'json', '--no-color'];
  if (fix) args.push('--fix');

  const { stdout, stderr, code, timedOut } = await spawnCapture(hmaBin, args, SCAN_TIMEOUT_MS);
  if (timedOut) {
    throw new Error(`HMA scan timed out after ${SCAN_TIMEOUT_MS / 1000}s`);
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    const snippet = stdout.slice(0, 200) || stderr.slice(0, 200) || '(empty)';
    throw new Error(`HMA did not return valid JSON (exit ${code}): ${snippet}`);
  }

  return {
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    exitCode: code,
  };
}

function findingIds(findings) {
  return findings.filter(f => f && f.passed === false).map(f => f.checkId).filter(Boolean);
}

function detailFromFinding(finding, status) {
  return {
    checkId: finding.checkId,
    status,
    name: finding.name || finding.checkId,
    severity: finding.severity || null,
    file: finding.file || null,
    message: finding.message || '',
    guidance: finding.guidance || '',
    fixable: !!finding.fixable,
    attackClass: finding.attackClass || null,
  };
}

/**
 * When an expected check didn't fire, try to give the user a useful reason
 * rather than a blank miss. Low confidence — this is a hint, not a diagnosis.
 */
function diagnoseMissing(checkId, allFindings) {
  const prefix = checkId.split('-')[0];
  const sameFamily = allFindings.filter(f => f && typeof f.checkId === 'string' && f.checkId.startsWith(`${prefix}-`));
  if (sameFamily.length === 0) {
    return `No checks from the ${prefix} family ran against this fixture. Either the installed HMA doesn't ship this check (try \`npx hackmyagent check-metadata | jq '.checks.${checkId}'\`), or the fixture has no files in its scope.`;
  }
  const ran = sameFamily.map(f => f.checkId).slice(0, 5).join(', ');
  return `${sameFamily.length} other ${prefix}-* check(s) ran (${ran}${sameFamily.length > 5 ? ', …' : ''}) but ${checkId} did not match. The fixture may be missing the specific pattern this check looks for.`;
}

/**
 * Spawn a process, buffer stdout/stderr, enforce a timeout.
 * Never uses a shell — args are passed as argv.
 */
function spawnCapture(cmd, args, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', buf => { stdout += buf.toString(); });
    child.stderr.on('data', buf => { stderr += buf.toString(); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), code: -1, timedOut });
    });
  });
}

/**
 * @typedef {object} ScanResult
 * @property {string}             name
 * @property {string[]}           expected       Expected check IDs.
 * @property {string[]}           fired          Expected checks that did fire.
 * @property {string[]}           missing        Expected checks that did NOT fire.
 * @property {ExpectedFinding[]}  expectedDetail Per-expected-check detail (status + guidance).
 * @property {number}             allFindingsCount  Total findings reported (fired + passed).
 * @property {number}             durationMs
 * @property {number}             exitCode
 * @property {boolean}            fix            Whether --fix was applied this run.
 *
 * @typedef {object} ExpectedFinding
 * @property {string}  checkId
 * @property {'fired'|'missing'} status
 * @property {string}  name
 * @property {string}  [severity]
 * @property {string}  [file]
 * @property {string}  [message]
 * @property {string}  [guidance]    "Why this matters" copy from HMA.
 * @property {boolean} [fixable]
 * @property {boolean} [fixed]
 * @property {string}  [attackClass]
 * @property {string}  [diagnostic]  Hint text when status === 'missing'.
 */
