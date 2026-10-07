/**
 * Port-publish hints bind to loopback (#129, #134).
 *
 * DVAA's agents are vulnerable on purpose, so every `docker run` hint in this
 * repository publishes their ports on 127.0.0.1 only. A `-p` or `--publish`
 * value with no host address in front publishes on every host interface and
 * exposes the agents to the local network: `<port>:<port>`, a range
 * `<first>-<last>:<first>-<last>`, or a container port alone (`<port>`, which
 * docker maps to a random host port). The scan finds the flag after any
 * non-word character (so markdown or HTML markup does not hide it), with the
 * value after whitespace, after `=`, attached to the flag, or as the next
 * element of an argv array on the same line (`"-p", "<port>:<port>"`). A
 * container port alone counts only after `docker run`, `docker create`,
 * `docker compose run` or the podman equivalents in the same command on the
 * line, written with spaces or as argv-array elements, with any global options
 * before the subcommand (`docker --context remote run`), and only with
 * whitespace or `=` before it, because `-p <number>` is also an ordinary
 * option of ssh, nc, ps, mysql and dev servers. `&&`, `;` and `|` end the
 * command unless they sit inside a quoted argument after the subcommand. A
 * value that goes on with `-<digit>` is not a port: a date such as
 * `2026-10-07`, and also a three-part value such as `9000-9001-9002`, which
 * is therefore not flagged. A value that names a host is allowed, including
 * an explicit `0.0.0.0:` or `[::]:` written on purpose (DOCKER_README.md
 * documents one for lab use).
 *
 * Not covered: combined short options (`-dp 9000:9000`), `-P` and
 * `--publish-all`, the long syntax (`--publish published=9000,target=9000`), a
 * port held in a variable, a flag and its value on separate lines (a `\`
 * continuation or a multi-line argv array), bash arrays (`("-p" "9000:9000")`),
 * compose `ports:` entries, and a container port alone after `docker-compose
 * run`. Still flagged although it is not a publish: a lone `-p <number>` of a
 * command run inside the container on a `docker run` or `docker compose run`
 * line (`docker run busybox nc -l -p <port>`, `docker compose run app nc -l -p
 * <port>`, `docker run busybox mkdir -p <year>`).
 *
 * The tree is walked with fs rather than `git ls-files` so the test also runs
 * where .git is absent. Skipped: dependency and VCS directories, runtime state
 * the server or tools write into the checkout, CHANGELOG.md (it records past
 * hints as history), and the scenarios/<name>/vulnerable scanner fixture
 * trees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_NAMES = new Set([
  'node_modules', '.git', '.worktrees', '.dvaa', '.dvaa-aim',
  '.hackmyagent-cache', '.hackmyagent-backup', 'coverage', 'dist', '.playwright-mcp',
]);
const SKIP_FILES = new Set(['CHANGELOG.md']);
const FIXTURE_TREE = 'vulnerable';

// `-p` or `--publish` after any non-word character, then a value that starts
// with a port number: after whitespace, `=` or nothing, or after the closing
// quote and comma of an argv-array element. The value is a port or range,
// optionally `:<port or range>`. The lookahead rejects a value that goes on as
// an IP address (127.0.0.1:..., also with escaped dots as in a regex), so a
// value with a host address in front does not match.
// It also rejects a value that goes on with `-<digit>`, such as the date in
// `mkdir -p 2026-10-07`: a port range is written `<first>-<last>`.
const ALL_INTERFACES = /(?<!\w)(?:-p|--publish)(?:\s+|=|["'`]\s*,\s*)?["'`]?(\d+(?:-\d+)?(?::\d+(?:-\d+)?)?)(?!\d|-\d|\\*\.\d)/g;

function isFixtureTree(rel) {
  const parts = rel.split(path.sep);
  return parts.length === 3 && parts[0] === 'scenarios' && parts[2] === FIXTURE_TREE;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(REPO_ROOT, full);
    if (entry.isDirectory()) {
      if (!isFixtureTree(rel)) walk(full, out);
    } else if (entry.isFile() && !SKIP_FILES.has(rel)) {
      out.push(rel);
    }
  }
  return out;
}

// A container port alone is a publish only as an option of `docker run`,
// `docker create`, `docker compose run` (or podman's), so it counts only when
// such a command precedes the flag on the line in the same command, and only
// with whitespace or `=` before the value (`-p1234` is mysql's password form).
// The line is split once into words and separators and walked with a small
// state machine, so the check is linear in the line length:
// - Words split on whitespace, `,`, `[`, `]`, `(` and `)`, so the argv-array
//   form (`"docker", ["run", "-p", "<port>"]`) reads like the shell form. Quote
//   characters are ignored when a word is compared.
// - `&&`, `;` and `|` end the command, except inside a quoted argument that
//   opens after the subcommand (`docker run -e "A=b;c"`). A quote opens only at
//   the start of a word, so the apostrophe in `won't` is not a quote.
// - Between `docker` or `podman` and the subcommand, a word starting with `-`
//   is a global option. Without `=`, it takes the next word as its value unless
//   that word starts with `-` or is the subcommand; a quoted value is taken
//   whole (`docker compose -f "a b.yml" run`).
const IDLE = 0;
const CMD = 1;
const SUB = 2;
const RUN = 3;
const CMD_WORD = /(?:^|\W)(?:docker|podman)\W*$/i;
const RUN_WORD = /^[^\w-]*(?:run|create)(?!\w)/i;
const SUB_WORD = /^[^\w-]*(?:compose|container)(?!\w)/i;
const WORD_BREAK = /[\s,[\]()]/;
const QUOTE_OPENS_AFTER = /[\s,[\]()=;|&]/;
const ATTACHED = /^(?:-p|--publish)["'`]?\d/;

function tokenize(line) {
  const tokens = [];
  const noClose = new Set();
  let span = null;
  let wordStart = -1;
  let wordQuoteEnd = -1;
  const flush = (end) => {
    if (wordStart < 0) return;
    const text = line.slice(wordStart, end).replace(/["'`]/g, '');
    tokens.push({ sep: false, start: wordStart, end, text, quoteEnd: wordQuoteEnd });
    wordStart = -1;
    wordQuoteEnd = -1;
  };
  for (let i = 0; i < line.length; i++) {
    if (span && i >= span.end) span = null;
    const c = line[i];
    let opened = -1;
    if (!span && (c === '"' || c === "'") && !noClose.has(c)
        && (i === 0 || QUOTE_OPENS_AFTER.test(line[i - 1]))) {
      const close = line.indexOf(c, i + 1);
      if (close < 0) noClose.add(c);
      else { span = { start: i, end: close + 1 }; opened = span.end; }
    }
    const pair = c === '&' && line[i + 1] === '&';
    if (WORD_BREAK.test(c)) {
      flush(i);
    } else if (c === ';' || c === '|' || pair) {
      flush(i);
      tokens.push({ sep: true, start: i, end: i + (pair ? 2 : 1), spanStart: span ? span.start : -1 });
      if (pair) i++;
    } else if (wordStart < 0) {
      wordStart = i;
      wordQuoteEnd = opened;
    }
  }
  flush(line.length);
  return tokens;
}

// For each token, whether a docker or podman run subcommand precedes it in the
// same command.
function runStates(tokens) {
  const inRun = new Array(tokens.length).fill(false);
  let state = IDLE;
  let runEnd = -1;
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    inRun[k] = state === RUN;
    if (tok.sep) {
      if (!(state === RUN && tok.spanStart >= runEnd)) state = IDLE;
      continue;
    }
    if (state === RUN) continue;
    const w = tok.text;
    if (CMD_WORD.test(w)) { state = CMD; continue; }
    if (state === CMD || state === SUB) {
      if (w.startsWith('-')) {
        const next = tokens[k + 1];
        if (!w.includes('=') && next && !next.sep && !next.text.startsWith('-')
            && !RUN_WORD.test(next.text)) {
          const valueEnd = next.quoteEnd >= 0 ? next.quoteEnd : next.end;
          while (k + 1 < tokens.length && tokens[k + 1].start < valueEnd) inRun[++k] = false;
        }
        continue;
      }
      if (RUN_WORD.test(w)) { state = RUN; runEnd = tok.end; continue; }
      if (state === CMD && SUB_WORD.test(w)) { state = SUB; continue; }
    }
    state = IDLE;
  }
  return inRun;
}

function findHits(text) {
  let tokens = null;
  let inRun = null;
  let k = 0;
  const loneIsPublish = (m) => {
    if (ATTACHED.test(m[0])) return false;
    if (!tokens) { tokens = tokenize(text); inRun = runStates(tokens); }
    while (k < tokens.length && tokens[k].end <= m.index) k++;
    return k < tokens.length && tokens[k].start <= m.index && inRun[k];
  };
  return [...text.matchAll(ALL_INTERFACES)]
    .filter((m) => m[1].includes(':') || loneIsPublish(m))
    .map((m) => m[1]);
}

test('the pattern flags a publish with no host address in the forms it covers', () => {
  // Built at run time so these lines do not trip the scan below.
  const p = '-p';
  const pub = `-${p}ublish`;
  const cases = [
    [`docker run ${p} 9000:9000 opena2a/dvaa`, '9000:9000'],
    [`Or: docker run ${p} 7001-7008:7001-7008 opena2a/dvaa`, '7001-7008:7001-7008'],
    [`"${p} 7010-7013:7010-7013 "`, '7010-7013:7010-7013'],
    [`docker run ${pub}=9000:9000 opena2a/dvaa`, '9000:9000'],
    [`docker run ${pub} 9000:9000 opena2a/dvaa`, '9000:9000'],
    // A container port alone: docker picks a random host port on every interface.
    [`docker run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker run ${pub}=9000 opena2a/dvaa`, '9000'],
    [`docker run ${p} 9000/tcp opena2a/dvaa`, '9000'],
    [`podman run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker create ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker container run ${pub}=9000 opena2a/dvaa`, '9000'],
    // A mapping followed by punctuation or prose.
    [`docker run ${p} 9000:9000: the agent answers on 9000`, '9000:9000'],
    [`a ${p} 9000:9000-style mapping`, '9000:9000'],
    // A value attached to the flag.
    [`docker run ${p}9000:9000 opena2a/dvaa`, '9000:9000'],
    [`docker run ${p}=9000:9000 opena2a/dvaa`, '9000:9000'],
    // The flag after markup or punctuation.
    [`Use **${p} 9000:9000** here.`, '9000:9000'],
    [`<code>${p} 9000:9000</code>`, '9000:9000'],
    [`[${p} 9000:9000]`, '9000:9000'],
    [`|${p} 9000:9000|`, '9000:9000'],
    [`Publish it with docker run ${p} 9000.`, '9000'],
    // The argv-array form.
    [`spawn("docker", ["run", "${p}", "9000:9000", "opena2a/dvaa"])`, '9000:9000'],
    [`subprocess.run(['docker', 'run', '${pub}', '7001-7008:7001-7008'])`, '7001-7008:7001-7008'],
    [`["run", "${p}9000:9000"]`, '9000:9000'],
    // A container port alone after global options, compose run, in argv form,
    // or after a quoted argument that holds `;` or `|` (#144).
    [`docker --context remote run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker -H tcp://host:2375 run ${p} 9000 opena2a/dvaa`, '9000'],
    [`podman --remote run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker compose run ${p} 9000 dvaa`, '9000'],
    [`spawn("docker", ["run", "${p}", "9000"])`, '9000'],
    [`execFile('docker',['run','${p}','9000'])`, '9000'],
    [`docker run -e "A=b;c" ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker run --label 'a|b' ${p} 9000 opena2a/dvaa`, '9000'],
    // A quoted global-option value is taken whole; an option never takes
    // another option as its value.
    [`docker --context "remote" run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker compose -f "a b.yml" run ${p} 9000 dvaa`, '9000'],
    [`docker --debug --context remote run ${p} 9000 opena2a/dvaa`, '9000'],
    [`docker -H tcp://docker-host:2375 run ${p} 9000 opena2a/dvaa`, '9000'],
  ];
  for (const [line, value] of cases) {
    assert.deepEqual(findHits(line), [value], `not flagged as it should be: ${line}`);
  }
});

test('the pattern passes a publish that names a host address', () => {
  const lines = [
    'docker run -p 127.0.0.1:9000:9000 opena2a/dvaa',
    'docker run -p 127.0.0.1:7001-7008:7001-7008 opena2a/dvaa',
    'docker run --publish=127.0.0.1:9000:9000 opena2a/dvaa',
    'spawn("docker", ["run", "-p", "127.0.0.1:9000:9000", "opena2a/dvaa"])',
    '/docker run --rm -p 127\\.0\\.0\\.1:9000:9000 opena2a\\/dvaa/',
    // An explicit all-interfaces host is a deliberate choice, not an omission.
    'docker run -p 0.0.0.0:9000:9000 opena2a/dvaa',
    'docker run -p [::]:9000:9000 opena2a/dvaa',
    'mkdir -p 2026-10-07',
  ];
  for (const line of lines) {
    assert.deepEqual(findHits(line), [], `flagged but names a host: ${line}`);
  }
});

test('the pattern passes -p <number> options that are not a docker or podman run publish', () => {
  const lines = [
    'ssh -p 2222 user@host',
    'nc -l -p 4444',
    'ps -p 1234',
    'next dev -p 3000',
    'docker exec db mysql -uroot -p1234',
    'docker run --rm mysql:8 mysql -uroot -p1234',
    'docker exec web ps -p 1',
    'docker compose -p 2026 up',
    'docker run --rm opena2a/dvaa && ssh -p 2222 user@host',
    'docker run --rm opena2a/dvaa; ssh -p 2222 user@host',
    'docker run --rm opena2a/dvaa | nc -l -p 4444',
    // A date is not a port range (#144).
    'docker run --rm busybox mkdir -p 2026-10-07',
    // A separator is never the value of a global option.
    'docker --version && run -p 3000',
    // An apostrophe inside a word does not open a quote.
    "docker run img won't stop; it's fine, ssh -p 2222 user@host",
    // A separator inside a quote that opened before the subcommand still counts,
    // as does one after a quote that never closes.
    'echo "docker run --rm img; ssh -p 2222 user@host"',
    'docker run -e "unclosed; ssh -p 2222 user@host',
  ];
  for (const line of lines) {
    assert.deepEqual(findHits(line), [], `flagged but is not a container publish: ${line}`);
  }
});

test('the check stays fast on long adversarial lines', () => {
  const size = 200 * 1024;
  const fill = (head, unit, tail) => head + unit.repeat(Math.ceil(size / unit.length)) + tail;
  const p = '-p';
  const lines = [
    // Global options in argv form, the shape that made a regex backtrack.
    fill('"docker"', ', "-a", "b"', `, "${p}", "9000"`),
    fill('docker', ' -a b', ` run ${p} 9000`),
    // Many lone ports after one run.
    fill('docker run', ` ${p} 9000`, ''),
    fill('', `docker run -e "a;" ${p} 9000 `, ''),
  ];
  for (const line of lines) {
    const t = performance.now();
    findHits(line);
    const ms = performance.now() - t;
    assert.ok(ms < 2000, `${ms.toFixed(0)} ms on a ${line.length}-byte line starting ${line.slice(0, 30)}`);
  }
});

test('the walk reaches the example scripts and skips the scanner fixtures', () => {
  const files = walk(REPO_ROOT);
  assert.ok(files.includes(path.join('scenarios', 'examples', 'README.md')), 'scenarios/examples/README.md not walked');
  assert.ok(files.includes(path.join('src', 'dashboard', 'server.js')), 'src/dashboard/server.js not walked');
  const scenariosDir = path.join(REPO_ROOT, 'scenarios');
  const withFixtures = fs.readdirSync(scenariosDir)
    .filter((name) => fs.existsSync(path.join(scenariosDir, name, 'vulnerable')));
  assert.ok(withFixtures.length > 0, 'no scenarios/<name>/vulnerable tree on disk');
  const walkedFixtures = files.filter((f) => /^scenarios[\\/][^\\/]+[\\/]vulnerable[\\/]/.test(f));
  assert.deepEqual(walkedFixtures, [], 'fixture files were walked');
});

test('no text file publishes a container port without a host address', () => {
  const hits = [];
  for (const rel of walk(REPO_ROOT)) {
    const buf = fs.readFileSync(path.join(REPO_ROOT, rel));
    if (buf.includes(0)) continue; // binary
    buf.toString('utf8').split('\n').forEach((line, i) => {
      for (const value of findHits(line)) hits.push(`${rel}:${i + 1}: -p ${value}`);
    });
  }
  assert.deepEqual(hits, [], `use -p 127.0.0.1:<port>:<port> instead:\n${hits.join('\n')}`);
});
