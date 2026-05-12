/**
 * HMA invocation wrapper for the dvaa CLI.
 *
 * Resolves hackmyagent across npm install layouts (nested, hoisted, global,
 * workspaces) so dvaa's HMA-delegating subcommands work in real npm consumer
 * installs — pre-fix every layout but the dvaa-repo-local one reported
 * "HackMyAgent not installed" (release-test 2026-05-12 P1).
 *
 * Spawn is argv-only (shell:false). Never pass user input through a shell.
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Walk up from `start`, looking for node_modules/.bin/hackmyagent. Handles
 * nested (<pkg>/node_modules/.bin/hackmyagent) and hoisted (root/node_modules/
 * .bin/hackmyagent) layouts uniformly.
 */
function findHmaBinByWalkUp(start) {
  let dir = start;
  while (true) {
    const candidate = path.join(dir, 'node_modules', '.bin', 'hackmyagent');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Use `require.resolve('hackmyagent/package.json')` to find hackmyagent's
 * install location, then read its `bin` field and resolve to the actual js
 * entry. Works in any layout npm/yarn/pnpm produces because Node's resolver
 * follows the same algorithm npm uses to wire `node_modules/.bin` symlinks.
 */
function findHmaBinByRequireResolve() {
  try {
    const pkgPath = require.resolve('hackmyagent/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const binField = pkg.bin;
    let binRel;
    if (typeof binField === 'string') {
      binRel = binField;
    } else if (binField && typeof binField === 'object') {
      binRel = binField.hackmyagent || Object.values(binField)[0];
    }
    if (!binRel) return null;
    const resolved = path.resolve(path.dirname(pkgPath), binRel);
    return fs.existsSync(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Find hackmyagent via PATH (`which`). Picks up global installs
 * (`npm i -g hackmyagent`, Homebrew taps).
 */
function findHmaBinOnPath() {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['hackmyagent'], {
    encoding: 'utf-8',
    shell: false,
  });
  if (result.status !== 0) return null;
  const first = (result.stdout || '').split(/\r?\n/).find(Boolean);
  return first && fs.existsSync(first) ? first : null;
}

let _cachedHmaBin = null;

/**
 * Resolution order:
 *  1. Walk-up from this file's __dirname (covers dvaa-repo-local and
 *     hoisted-into-consumer-root). This is the cheapest check.
 *  2. require.resolve('hackmyagent/package.json') → bin (covers pnpm, yarn
 *     workspaces, and any exotic layout the resolver supports).
 *  3. PATH lookup (covers `npm i -g hackmyagent`).
 *
 * Cached for the process lifetime — the binary path doesn't move mid-run.
 */
export function getHmaBinPath() {
  if (_cachedHmaBin) return _cachedHmaBin;
  _cachedHmaBin =
    findHmaBinByWalkUp(__dirname) ||
    findHmaBinByRequireResolve() ||
    findHmaBinOnPath();
  return _cachedHmaBin;
}

export function hmaIsInstalled() {
  return getHmaBinPath() !== null;
}

// Test seam — reset cache between unit tests so process-lifetime caching
// doesn't bleed across cases. Not part of the public CLI surface.
export function _resetHmaBinCacheForTests() {
  _cachedHmaBin = null;
}

/**
 * Run HMA with argv, inherit stdio so the user sees HMA's output live.
 * Returns the exit code so the CLI can propagate.
 */
export function runHmaInherit(argv) {
  const bin = getHmaBinPath();
  if (!bin) {
    console.error('HackMyAgent not found.');
    console.error('Run: npm install hackmyagent  (or: npm install -g hackmyagent)');
    return 1;
  }
  const result = spawnSync(bin, argv, { stdio: 'inherit', shell: false });
  return result.status ?? 1;
}

/**
 * Run HMA and capture stdout as JSON. For commands that want to post-process
 * HMA's output (filter, reshape, re-emit).
 */
export async function runHmaJson(argv, { timeoutMs = 60_000 } = {}) {
  const bin = getHmaBinPath();
  if (!bin) {
    throw new Error('HackMyAgent not found. Run `npm install hackmyagent` (or `npm install -g hackmyagent`).');
  }
  const { stdout, stderr, code } = await spawnCapture(bin, argv, timeoutMs);
  try {
    return { parsed: JSON.parse(stdout), exitCode: code };
  } catch {
    const preview = (stdout || stderr).slice(0, 200) || '(empty)';
    throw new Error(`HMA did not return valid JSON (exit ${code}): ${preview}`);
  }
}

function spawnCapture(cmd, args, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', buf => { stdout += buf.toString(); });
    child.stderr.on('data', buf => { stderr += buf.toString(); });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + String(err), code: -1 });
    });
  });
}
