/**
 * The release workflow's "Verify provenance on npm" step passes only when the
 * registry serves an SLSA v1 provenance attestation for the exact version the
 * run published.
 *
 * The step's `run:` block is read from .github/workflows/release.yml and run as
 * written under `bash -e`, the shell GitHub Actions uses when a step names
 * none, in a directory whose package.json carries the version under test.
 * `npm` and `sleep` resolve to stubs, so no cell reaches the network or waits:
 * the npm stub answers `npm view <spec> dist.attestations --json` from a table
 * per cell and records each spec it is asked for. `node` and `jq` are the real
 * ones. The answers were recorded from the public registry with npm 11: the
 * attestation document of 0.9.2, and the E404 for 0.9.3, a version that was not
 * published when it was recorded. The E404 puts a JSON error object on stdout
 * and exits 1; the stderr line naming the local debug-log file is left out.
 *
 * (a) the E404 of an unpublished version fails the step;
 * (b) an older version's attestation does not satisfy the version published;
 * (c) 0.9.2 passes on its own attestation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'release.yml');
const STEP_NAME = 'Verify provenance on npm';
const PKG = 'damn-vulnerable-ai-agent';

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

// npm view damn-vulnerable-ai-agent@0.9.2 dist.attestations --json
const ATTESTATION_0_9_2 = {
  stdout: json({
    url: `https://registry.npmjs.org/-/npm/v1/attestations/${PKG}@0.9.2`,
    provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
  }),
  stderr: '',
  code: 0,
};

// npm view damn-vulnerable-ai-agent@0.9.3 dist.attestations --json, 0.9.3 unpublished
const NOT_FOUND_0_9_3 = `The requested resource '${PKG}@0.9.3' could not be found or you do not have permission to access it.`;
const E404_0_9_3 = {
  stdout: json({
    error: {
      code: 'E404',
      summary: 'No match found for version 0.9.3',
      detail: `${NOT_FOUND_0_9_3}\n\nNote that you can also install from a\ntarball, folder, http url, or git url.`,
    },
  }),
  stderr: [
    'npm error code E404',
    'npm error 404 No match found for version 0.9.3',
    'npm error 404',
    `npm error 404  ${NOT_FOUND_0_9_3}`,
    'npm error 404',
    'npm error 404 Note that you can also install from a',
    'npm error 404 tarball, folder, http url, or git url.',
    '',
  ].join('\n'),
  code: 1,
};

// The literal block under the step's `run: |`, with its indentation removed.
function stepScript(name) {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${name}`);
  assert.notEqual(start, -1, `release.yml has no step named "${name}"`);
  const stepIndent = lines[start].indexOf('-');
  let run = start + 1;
  while (run < lines.length && !/^\s*run: \|\s*$/.test(lines[run])) {
    assert.ok(lines[run].trim() === '' || lines[run].search(/\S/) > stepIndent, `step "${name}" has no run: | block`);
    run += 1;
  }
  assert.ok(run < lines.length, `step "${name}" has no run: | block`);
  const keyIndent = lines[run].search(/\S/);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== '' && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.search(/\S/)));
  return `${body.map((line) => line.slice(indent)).join('\n').trimEnd()}\n`;
}

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

// Answers `npm view <spec> dist.attestations --json` from answers/<spec>/, or
// answers/.any/ for any spec, and records each call. Any other call, or a spec
// with no answer, exits 2.
const npmStub = (answersDir, logFile) => `#!/bin/sh
printf '%s\\n' "$*" >> ${shellQuote(logFile)}
if [ "$#" -eq 4 ] && [ "$1" = view ] && [ "$3" = dist.attestations ] && [ "$4" = --json ]; then
  answer=${shellQuote(answersDir)}/"$2"
  [ -d "$answer" ] || answer=${shellQuote(answersDir)}/.any
  if [ -d "$answer" ]; then
    cat "$answer/stdout"
    cat "$answer/stderr" >&2
    exit "$(cat "$answer/code")"
  fi
fi
echo "npm stub: no answer for: npm $*" >&2
exit 2
`;

function runStep({ version, registry }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-release-verify-'));
  try {
    const bin = path.join(dir, 'bin');
    const work = path.join(dir, 'work');
    fs.mkdirSync(bin);
    fs.mkdirSync(work);
    const answersDir = path.join(dir, 'answers');
    const logFile = path.join(dir, 'requests.log');
    const stepFile = path.join(dir, 'step.sh');
    for (const [spec, answer] of Object.entries(registry)) {
      const at = path.join(answersDir, spec === '*' ? '.any' : spec);
      fs.mkdirSync(at, { recursive: true });
      fs.writeFileSync(path.join(at, 'stdout'), answer.stdout);
      fs.writeFileSync(path.join(at, 'stderr'), answer.stderr);
      fs.writeFileSync(path.join(at, 'code'), String(answer.code));
    }
    fs.writeFileSync(logFile, '');
    fs.writeFileSync(path.join(bin, 'npm'), npmStub(answersDir, logFile), { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: PKG, version }));
    fs.writeFileSync(stepFile, stepScript(STEP_NAME));
    const env = { PATH: `${bin}${path.delimiter}${process.env.PATH}`, HOME: dir };

    // The stubs resolve first in the step's own shell, or the step would reach the registry.
    const found = spawnSync('bash', ['-c', 'command -v npm sleep jq'], { cwd: work, env, encoding: 'utf8' });
    const [npm, sleep, jq] = found.stdout.split('\n');
    assert.equal(npm, path.join(bin, 'npm'), 'npm resolves to the stub');
    assert.equal(sleep, path.join(bin, 'sleep'), 'sleep resolves to the stub');
    assert.ok(jq, 'jq is installed (the step runs it)');

    const run = spawnSync('bash', ['-e', stepFile], { cwd: work, env, encoding: 'utf8', timeout: 60_000 });
    const requests = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((line) => line.split(' ')[1]);
    return { status: run.status, output: `${run.stdout}${run.stderr}`, requests };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// (a) Every query gets the E404 of the unpublished version.
test('the E404 of an unpublished version fails the step', () => {
  const run = runStep({ version: '0.9.3', registry: { '*': E404_0_9_3 } });
  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, new RegExp(`::error::.*${PKG}@0\\.9\\.3`), run.output);
});

// (b) The registry's latest is 0.9.2, with its attestation; 0.9.3 is not visible yet.
test("an older version's attestation does not satisfy the version being published", () => {
  const run = runStep({
    version: '0.9.3',
    registry: { [PKG]: ATTESTATION_0_9_2, [`${PKG}@0.9.2`]: ATTESTATION_0_9_2, [`${PKG}@0.9.3`]: E404_0_9_3 },
  });
  assert.notEqual(run.status, 0, run.output);
  assert.deepEqual([...new Set(run.requests)], [`${PKG}@0.9.3`]);
});

// (c) The registry's latest is 0.9.2, with its attestation.
test('0.9.2 passes on its own attestation', () => {
  const run = runStep({
    version: '0.9.2',
    registry: { [PKG]: ATTESTATION_0_9_2, [`${PKG}@0.9.2`]: ATTESTATION_0_9_2 },
  });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.requests, [`${PKG}@0.9.2`]);
});
