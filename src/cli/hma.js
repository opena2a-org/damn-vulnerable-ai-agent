/**
 * HMA invocation wrapper for the dvaa CLI.
 *
 * Always uses the bundled node_modules/.bin/hackmyagent (matching scanner.js in
 * the dashboard) so the CLI and dashboard scan paths behave identically and
 * stay in version-parity with scenarios/<name>/expected-checks.json.
 *
 * Spawn is argv-only (shell:false). Never pass user input through a shell.
 */

import { spawn, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '../..');
const HMA_BIN = path.join(PKG_ROOT, 'node_modules', '.bin', 'hackmyagent');

export function getHmaBinPath() {
  return HMA_BIN;
}

export function hmaIsInstalled() {
  return fs.existsSync(HMA_BIN);
}

/**
 * Run HMA with argv, inherit stdio so the user sees HMA's output live.
 * Returns the exit code so the CLI can propagate.
 */
export function runHmaInherit(argv) {
  if (!hmaIsInstalled()) {
    console.error('HackMyAgent not installed at node_modules/.bin/hackmyagent.');
    console.error('Run: npm install');
    return 1;
  }
  const result = spawnSync(HMA_BIN, argv, { stdio: 'inherit', shell: false });
  return result.status ?? 1;
}

/**
 * Run HMA and capture stdout as JSON. For commands that want to post-process
 * HMA's output (filter, reshape, re-emit).
 */
export async function runHmaJson(argv, { timeoutMs = 60_000 } = {}) {
  if (!hmaIsInstalled()) {
    throw new Error('HackMyAgent not installed at node_modules/.bin/hackmyagent. Run `npm install`.');
  }
  const { stdout, stderr, code } = await spawnCapture(HMA_BIN, argv, timeoutMs);
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
