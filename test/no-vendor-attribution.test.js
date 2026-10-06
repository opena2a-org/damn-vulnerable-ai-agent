/**
 * The review gate names the reviewer by what it does, not by the vendor of the model it calls.
 *
 * `.github/workflows/pr-review.yml` is the required check on main, and a job's
 * `name:` IS the status context branch protection asks for -- so this rename is
 * not cosmetic. Three lines named the vendor as the grammatical SUBJECT of our
 * own review: the job name (the context), the model-call step name, and the
 * heading the job posts on every pull request. Five sibling repos already
 * say all three this way, and these strings are copied from them.
 *
 *   AC1  the three lines read the org form, byte for byte;
 *   AC2  nothing else in that workflow moved;
 *   AC3  no other file in the tree carries the old name either;
 *   AC4  the AC3 walker can actually fail -- shown against a planted file -- and
 *        does not fire on the benign shapes that sit next to it.
 *
 * The vendor name as the grammatical OBJECT of a line is a different thing and
 * is deliberately left alone: `uses: opena2a-org/.github/actions/claude-review@<sha>`
 * is a repository path, and rewriting it would make the line false. AC3's
 * predicate is the old context name literally and only, so that line is not
 * matched and needs no allowlist.
 *
 * This file is the one file in the tree that carries the banned string -- it
 * plants it in AC4 -- so the walk skips exactly its own path and nothing else.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SELF), '..');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'pr-review.yml');

/** The vendor-as-subject name no file in this repository may carry. */
const BANNED = 'Claude Code Review';

/**
 * Directories the walk does not descend: every directory `.gitignore` lists,
 * plus `.git`. Nothing under these is part of the repository's own text.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.dvaa',
  '.dvaa-aim',
  '.hackmyagent-cache',
  '.hackmyagent-backup',
  '.playwright-mcp',
  '.git',
]);

/** A file whose first bytes carry a NUL is not text and is not read as text. */
const NUL_PROBE_BYTES = 8000;

/**
 * Every line of the workflow that this rename moved, 1-based as the file reads,
 * with the exact bytes it must now carry. Line 34 is the job `name:`, which is
 * the status context this workflow reports and the one branch protection on
 * main requires by string.
 */
const RENAMED = [
  [34, '    name: Automated code review'],
  [144, '      - name: Run automated review'],
  [258, '            echo "## Automated code review — $VERDICT"'],
];

/**
 * sha256 of `.github/workflows/pr-review.yml` at base
 * faf3fb172ef526d12db0eb5377701549693118a6 with lines 34, 144 and 258 removed --
 * i.e. of every line the rename did not touch. Re-derive after an intentional
 * change to this workflow with `node -e` over the same three deletions.
 */
const WORKFLOW_DIGEST_WITHOUT_RENAMED_LINES =
  '45b526bb704f7c63db1c8edd8951b08fe0b64cd25669ef96af74e6a42ee9767a';

/** Splits on newlines: 301 newline-terminated lines leave a 302nd empty tail. */
function readWorkflowLines() {
  return fs.readFileSync(WORKFLOW, 'utf8').split('\n');
}

function digestWithoutRenamedLines(lines) {
  const removed = new Set(RENAMED.map(([lineNo]) => lineNo - 1));
  const kept = lines.filter((_, i) => !removed.has(i));
  return crypto.createHash('sha256').update(kept.join('\n')).digest('hex');
}

/**
 * Walks `root` and reports `<path>:<line>` -- path relative to `root` -- for
 * every line carrying BANNED. `skipPath` is the single absolute path the walk
 * leaves out, which is how this file excludes itself and nothing else.
 *
 * The same walker serves the tree assertion and the planted shapes, so a plant
 * travels the exact code path a real hit would.
 */
function reportVendorAttribution(root, { skipPath = null } = {}) {
  const report = [];
  const stats = { filesRead: 0, binarySkipped: [] };

  const visit = (dir) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => (a.name < b.name ? -1 : 1));

    for (const entry of entries) {
      const abs = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(abs);
        continue;
      }
      if (!entry.isFile()) continue; // symlinks, sockets, fifos: nothing to read
      if (skipPath !== null && abs === skipPath) continue;

      const rel = path.relative(root, abs);
      const bytes = fs.readFileSync(abs);
      if (bytes.subarray(0, NUL_PROBE_BYTES).includes(0)) {
        stats.binarySkipped.push(rel);
        continue;
      }

      stats.filesRead += 1;
      bytes
        .toString('utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes(BANNED)) report.push(`${rel}:${i + 1}`);
        });
    }
  };

  visit(root);
  return { report, stats };
}

/** The assertion AC3 makes and AC4 shows failing. */
function assertNoVendorAttribution({ report, stats }) {
  assert.deepEqual(
    report,
    [],
    `${report.length} line(s) name the vendor as the subject of our own review ` +
      `(read ${stats.filesRead} text files, skipped ${stats.binarySkipped.length} as binary)`,
  );
}

/** Temporary trees the planted-fault cases walk; removed when the suite ends. */
const plantedDirs = [];

function plantLine(line, { subdir = '.' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-vendor-gate-'));
  plantedDirs.push(root);
  const dir = path.join(root, subdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'planted.txt'), `${line}\n`);
  return root;
}

after(() => {
  for (const dir of plantedDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('the job, the model-call step and the posted heading name the reviewer by what it does', () => {
  const lines = readWorkflowLines();

  for (const [lineNo, expected] of RENAMED) {
    assert.equal(lines[lineNo - 1], expected, `.github/workflows/pr-review.yml:${lineNo}`);
  }
});

test('nothing else in pr-review.yml moved', () => {
  const lines = readWorkflowLines();

  assert.equal(lines.length, 302, '301 newline-terminated lines, unchanged from base');
  assert.equal(lines[0], 'name: PR Review');
  assert.equal(lines[32], '  review:', 'the job id stays `review`');
  assert.equal(
    lines[151],
    '        uses: opena2a-org/.github/actions/claude-review@025b1897886f261c12ccc79da3f75d345842c897',
    'the shared model call stays SHA-pinned, on the same SHA',
  );

  assert.equal(
    digestWithoutRenamedLines(lines),
    WORKFLOW_DIGEST_WITHOUT_RENAMED_LINES,
    'every line except 34, 144 and 258 must stay byte-identical to base ' +
      'faf3fb172ef526d12db0eb5377701549693118a6 -- trigger, concurrency, permissions, ' +
      'checkout, the SYSPROMPT heredoc and its __NONCE__ placeholder, the pinned action ' +
      'and its inputs, the four review-path cases and the three-way verdict case',
  );
});

test('no file in the tree names the vendor as the subject that reviewed our code', () => {
  assertNoVendorAttribution(reportVendorAttribution(REPO_ROOT, { skipPath: SELF }));
});

test('a planted vendor-as-subject line is reported, and the emptiness assertion fails on it', () => {
  const root = plantLine(BANNED);
  const walked = reportVendorAttribution(root);

  assert.deepEqual(walked.report, ['planted.txt:1']);
  assert.throws(
    () => assertNoVendorAttribution(walked),
    assert.AssertionError,
    'the gate must be able to fail: a real hit has to refuse the same assertion AC3 makes',
  );
});

test('a local settings path is not reported', () => {
  const walked = reportVendorAttribution(plantLine('.claude/settings.json'));
  assert.deepEqual(walked.report, []);
});

test('the runtime dependency @anthropic-ai/sdk is not reported', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['@anthropic-ai/sdk'], 'the shape below is a dependency we really declare');

  const walked = reportVendorAttribution(plantLine('@anthropic-ai/sdk'));
  assert.deepEqual(walked.report, []);
});

test('a hit inside node_modules is not reported', () => {
  const walked = reportVendorAttribution(plantLine(BANNED, { subdir: path.join('node_modules', 'pkg') }));
  assert.deepEqual(walked.report, [], 'the skip list is exercised, not assumed');
});
