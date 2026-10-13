/**
 * HMA scanner bridge.
 *
 * Resolves hackmyagent via the shared CLI resolver (cli/hma.js getHmaBinPath)
 * and runs it against a scenario's vulnerable/ fixture, parses the JSON
 * output, and returns a structured result the UI can render directly (fired,
 * missing, diagnostic text per finding).
 *
 * Every run works on a per-request temporary copy of the fixture. HackMyAgent
 * only receives the copy, so a scan or --fix does not write to the shipped
 * scenarios/ tree. A fix run is judged by
 * comparing a baseline scan with a re-scan of the fixed copy, and it reports
 * which files the fix changed.
 *
 * Prefers the locally-installed hackmyagent (pinned in package.json) but
 * falls back to require.resolve / PATH so the dashboard works in any npm
 * install layout. Version-parity with expected-checks.json is enforced by
 * pinning hackmyagent's version in package.json, not by the resolver path.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getHmaBinPath } from '../cli/hma.js';

const SCAN_TIMEOUT_MS = 60_000;

// Flags on every `hackmyagent secure` run:
//   --no-registry, --no-contribute  results stay on this machine.
//   --static-only                   deterministic static checks with no model
//                                   download. expected-checks.json and
//                                   scenarios/verify-all.sh use the same set.
//   --no-machine-posture            scan the fixture only, not the AI runtimes
//                                   installed in the user's home directory.
export const HMA_SCAN_FLAGS = Object.freeze([
  '--format', 'json', '--no-color',
  '--no-registry', '--no-contribute',
  '--static-only', '--no-machine-posture',
]);

// HackMyAgent writes its pre-fix backups here; they are not part of the diff.
const HMA_BACKUP_DIR = '.hackmyagent-backup';
// Changed lines shown per file in a fix run's diff summary.
const PREVIEW_LINES = 12;

// HMA's `check-metadata` command scans test fixtures to build a registry of
// every check ID it ships. That takes ~20s, so we cache the JSON on disk
// keyed by HMA version: .hackmyagent-cache/check-metadata-v<version>.json.
// Dashboard keeps an in-memory copy too so repeat /scan calls are instant.
let checkRegistryCache = null;

async function loadCheckRegistry(hmaBin) {
  if (checkRegistryCache !== null) return checkRegistryCache;

  const pkgRoot = path.resolve(hmaBin, '../../..');
  const cacheDir = path.join(pkgRoot, '.hackmyagent-cache');
  const version = await getHmaVersion(hmaBin);
  const cacheFile = version
    ? path.join(cacheDir, `check-metadata-v${version}.json`)
    : null;

  // Disk cache hit — fast path. The Dockerfile pre-generates this file from
  // raw `check-metadata` output ({ checks: {...}, ... }); this module writes
  // the bare checks map. Accept both.
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      checkRegistryCache = cached && typeof cached.checks === 'object' ? cached.checks : cached;
      return checkRegistryCache;
    } catch { /* corrupt file — fall through to regenerate */ }
  }

  // Cold path: spawn HMA and populate the cache.
  try {
    const { stdout } = await spawnCapture(hmaBin, ['check-metadata'], 30_000);
    const parsed = JSON.parse(stdout);
    checkRegistryCache = parsed.checks || {};
    if (cacheFile) {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(checkRegistryCache));
      } catch { /* non-fatal */ }
    }
  } catch {
    checkRegistryCache = {};
  }
  return checkRegistryCache;
}

async function getHmaVersion(hmaBin) {
  try {
    const { stdout } = await spawnCapture(hmaBin, ['--version'], 5_000);
    // HMA prints "hackmyagent 0.11.15" or just "0.11.15" depending on build.
    const match = stdout.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Run HMA against a temporary copy of scenarios/<name>/vulnerable/ and return
 * parsed results. runScan only reads the shipped fixture.
 *
 * @param {object}   opts
 * @param {string}   opts.pkgRoot    Absolute path to the DVAA package root.
 * @param {string}   opts.name       Scenario directory name (must already be validated by caller).
 * @param {string[]} opts.expected   Expected check IDs from scenario's expected-checks.json.
 * @param {boolean}  [opts.fix=false] Apply HMA's --fix to the copy and report what changed.
 * @param {string}   [opts.hmaBin]   HackMyAgent binary; defaults to the resolved install.
 * @returns {Promise<ScanResult>}
 */
export async function runScan({ pkgRoot, name, expected, fix = false, hmaBin = getHmaBinPath() }) {
  const fixtureDir = path.join(pkgRoot, 'scenarios', name, 'vulnerable');

  if (!hmaBin) {
    throw new Error('HMA binary not found. Run `npm install hackmyagent` (or `npm install -g hackmyagent`).');
  }
  if (!fs.existsSync(fixtureDir)) {
    throw new Error(`Scenario has no vulnerable/ directory: ${name}`);
  }

  const started = Date.now();
  const registry = await loadCheckRegistry(hmaBin);

  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-scan-'));
  try {
    const workDir = path.join(workRoot, 'vulnerable');
    // Symlinks are left out of the copy, so a fix cannot follow one to a file
    // outside it.
    fs.cpSync(fixtureDir, workDir, {
      recursive: true,
      filter: src => !fs.lstatSync(src).isSymbolicLink(),
    });

    // Fix runs need a baseline to tell "fixed" apart from "never fired". The
    // fix is then judged by re-scanning the fixed copy, not by the --fix
    // output, whose shape differs between HMA versions.
    const baseline = fix ? await runHma(hmaBin, workDir) : null;
    if (fix) await runHma(hmaBin, workDir, { fix: true });
    const current = await runHma(hmaBin, workDir);
    const changes = fix ? diffTrees(fixtureDir, workDir) : null;
    const durationMs = Date.now() - started;
    return buildResult({ name, expected, fix, registry, baseline, current, changes, durationMs });
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function buildResult({ name, expected, fix, registry, baseline, current, changes, durationMs }) {
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
    changes,
  };
}

async function runHma(hmaBin, targetDir, { fix = false } = {}) {
  const args = ['secure', targetDir, ...HMA_SCAN_FLAGS];
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

/**
 * Compare the pristine fixture with the fixed copy: which files the fix added,
 * removed or modified, with line counts and a short preview of changed lines.
 */
function diffTrees(originalDir, fixedDir) {
  const before = listFiles(originalDir);
  const after = listFiles(fixedDir);
  const files = [];
  for (const rel of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(rel);
    const b = after.get(rel);
    if (a && b && a.equals(b)) continue;
    const status = !a ? 'added' : !b ? 'removed' : 'modified';
    files.push({ path: rel, status, ...lineDiff(a, b) });
  }
  return { files };
}

// Relative POSIX path -> file contents, skipping HMA's backup directory.
function listFiles(root) {
  const out = new Map();
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (dir === root && entry.name === HMA_BACKUP_DIR) continue;
        walk(abs);
      } else if (entry.isFile()) {
        out.set(path.relative(root, abs).split(path.sep).join('/'), fs.readFileSync(abs));
      }
    }
  })(root);
  return out;
}

// Line-level diff of two buffers (either may be undefined for an added or
// removed file). Returns counts plus the first PREVIEW_LINES changed lines.
// Exported for tests.
export function lineDiff(before, after) {
  if ((before && before.includes(0)) || (after && after.includes(0))) {
    return { binary: true, added: 0, removed: 0, preview: [], truncated: false };
  }
  const toLines = buf => {
    if (!buf) return [];
    const lines = buf.toString('utf-8').split('\n');
    if (lines[lines.length - 1] === '') lines.pop();   // text that ends with a newline
    return lines;
  };
  const a = toLines(before);
  const b = toLines(after);

  // Strip the common prefix and suffix, then run an LCS over the middle.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  const ops = [];
  if (midA.length * midB.length > 4_000_000) {
    // Too large for a line-level LCS: report the whole changed region.
    for (const line of midA) ops.push(`- ${line}`);
    for (const line of midB) ops.push(`+ ${line}`);
  } else {
    const n = midA.length;
    const m = midB.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { i++; j++; } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        ops.push(`- ${midA[i++]}`);
      } else {
        ops.push(`+ ${midB[j++]}`);
      }
    }
    while (i < n) ops.push(`- ${midA[i++]}`);
    while (j < m) ops.push(`+ ${midB[j++]}`);
  }

  return {
    added: ops.filter(op => op.startsWith('+')).length,
    removed: ops.filter(op => op.startsWith('-')).length,
    preview: ops.slice(0, PREVIEW_LINES),
    truncated: ops.length > PREVIEW_LINES,
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
 * @property {boolean}            fix            Whether --fix was applied (to a temporary copy) this run.
 * @property {ScanChanges|null}   changes        On a fix run, what the fix changed in the copy; null otherwise.
 *
 * @typedef {object} ScanChanges
 * @property {ChangedFile[]} files
 *
 * @typedef {object} ChangedFile
 * @property {string}   path       POSIX path relative to vulnerable/.
 * @property {'added'|'removed'|'modified'} status
 * @property {number}   added      Lines added.
 * @property {number}   removed    Lines removed.
 * @property {string[]} preview    First changed lines, prefixed "+ " or "- ".
 * @property {boolean}  truncated  More changed lines exist than the preview shows.
 * @property {boolean}  [binary]   Binary file: no line counts.
 *
 * @typedef {object} ExpectedFinding
 * @property {string}  checkId
 * @property {'fired'|'fixed'|'missing'} status
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
