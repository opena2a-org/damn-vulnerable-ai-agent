/**
 * Dockerfile RUN steps call hackmyagent with telemetry off.
 *
 * The image build runs hackmyagent to pre-generate its check-metadata cache.
 * That run is our build, not anyone's use of the scanner, so every hackmyagent
 * call in a RUN step carries OPENA2A_TELEMETRY=off. The switch sits on the
 * call rather than in an image ENV, so a running container still follows the
 * telemetry choice of whoever starts it.
 *
 * Every Dockerfile in the tree is read (Dockerfile, Dockerfile.<name>,
 * <name>.Dockerfile, Containerfile), the scenario fixtures included. Lines are
 * joined the way docker joins them: a continuation skips comment and empty
 * lines, and a `# escape=` directive sets the continuation character. RUN and
 * ONBUILD RUN are read in the shell, exec and heredoc forms, after any
 * `--mount`, `--network` or `--security` flags. The command is split into
 * simple commands at `;`, `&`, `|`, a newline and a reserved word (`if`,
 * `then`, `do`, `{`, ...) in command position; `$(...)`, `(...)` and a
 * backtick pair hold commands of their own. Quotes are ignored when the
 * command is split, so a quoted script such as the argument of `sh -c` is read
 * as commands too.
 *
 * A word is a call when one of its path segments, without an `@<version>`
 * suffix, is `hackmyagent`: `node_modules/.bin/hackmyagent`,
 * `npx hackmyagent@latest`, `node node_modules/hackmyagent/dist/cli.js`. It
 * counts wherever it stands in the command (after npx, xargs or sh -c, and
 * after npm install too), so a launcher the check does not know cannot hide a
 * call.
 *
 * A call passes when its simple command starts with OPENA2A_TELEMETRY=off,
 * among other assignments and redirections or after `env`:
 * `OPENA2A_TELEMETRY=off <command>` or `env OPENA2A_TELEMETRY=off <command>`.
 * It fails when the variable is missing or has another value (a quoted value
 * with a space in it included), when it is set on another command
 * (`OPENA2A_TELEMETRY=off npm ci && hackmyagent ...`), by `export` or by an
 * ENV or ARG line, and when `env -i` or `env -u` clears it.
 *
 * Not covered: a call through a variable (`$HMA check-metadata`). Flagged
 * although the switch reaches the call: the switch at the start of a quoted
 * script (`sh -c "OPENA2A_TELEMETRY=off hackmyagent ..."`; write it in front
 * of `sh`), a call after `;`, `&&` or `|` in a quoted script or a heredoc
 * whose outer command sets the switch (write it on the call), and a word that
 * names the package without running it (`rm -rf node_modules/hackmyagent`).
 *
 * The tree is walked with fs rather than `git ls-files` so the test also runs
 * where .git is absent. Skipped: dependency and VCS directories and runtime
 * state the server or tools write into the checkout.
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
const DOCKERFILE = /^(?:dockerfile|containerfile)(?:\..+)?$|\.(?:dockerfile|containerfile)$/i;
const SWITCH = 'OPENA2A_TELEMETRY';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && DOCKERFILE.test(entry.name) && !entry.name.endsWith('.dockerignore')) {
      out.push(path.relative(REPO_ROOT, full));
    }
  }
  return out;
}

// The line of an offset into text joined from several lines; `starts` holds
// [offset, line] for each joined line, in order.
function lineOf(starts, offset) {
  let line = starts[0][1];
  for (const [at, n] of starts) if (at <= offset) line = n;
  return line;
}

const BLANK_OR_COMMENT = /^\s*(?:#|$)/;
const DIRECTIVE = /^#\s*([a-z]+)\s*=\s*(\S+)\s*$/i;
const RUN_STEP = /^\s*(?:onbuild\s+)?run(?:\s+|$)([\s\S]*)$/i;
const RUN_FLAGS = /^(?:--[\w-]+(?:=\S*)?\s+)*/;
const HEREDOC = /(?<!<)<<(?!<)(-?)\s*(["']?)([A-Za-z_][\w-]*)\2/g;

// The shell scripts a Dockerfile's RUN steps run, each { text, lineAt }: the
// command of the step, and the body of each heredoc it opens.
function runScripts(source) {
  const lines = source.split(/\r?\n/);
  let escape = '\\';
  for (const line of lines) {
    const directive = DIRECTIVE.exec(line);
    if (!directive) break;
    if (directive[1].toLowerCase() === 'escape') escape = directive[2];
  }
  const scripts = [];
  for (let n = 0; n < lines.length; n++) {
    if (BLANK_OR_COMMENT.test(lines[n])) continue;
    let text = '';
    const starts = [];
    for (; n < lines.length; n++) {
      if (starts.length && BLANK_OR_COMMENT.test(lines[n])) continue;
      const line = lines[n].replace(/\s+$/, '');
      starts.push([text.length, n + 1]);
      if (!line.endsWith(escape)) { text += line; break; }
      text += line.slice(0, -escape.length);
    }
    const step = RUN_STEP.exec(text);
    if (step) {
      const at = text.length - step[1].length + RUN_FLAGS.exec(step[1])[0].length;
      const command = text.slice(at);
      let argv = null;
      try { argv = command.startsWith('[') ? JSON.parse(command) : null; } catch { argv = null; }
      if (Array.isArray(argv) && argv.every((arg) => typeof arg === 'string')) {
        // The exec form: each argument stays one quoted word, and the script
        // an argument of `sh -c` holds is read as commands.
        scripts.push({ text: argv.map((arg) => JSON.stringify(arg)).join(' '), lineAt: () => starts[0][1] });
      } else {
        scripts.push({ text: command, lineAt: (offset) => lineOf(starts, at + offset) });
      }
    }
    // Heredoc bodies follow the instruction; a delimiter that never comes
    // opens none.
    for (const heredoc of text.matchAll(HEREDOC)) {
      let end = n + 1;
      const strip = (line) => (heredoc[1] ? line.replace(/^\t+/, '') : line);
      while (end < lines.length && strip(lines[end]) !== heredoc[3]) end++;
      if (end === lines.length) continue;
      if (step) {
        const body = lines.slice(n + 1, end);
        const bodyStarts = [];
        let offset = 0;
        body.forEach((line, k) => { bodyStarts.push([offset, n + 2 + k]); offset += line.length + 1; });
        scripts.push({ text: body.join('\n'), lineAt: (o) => lineOf(bodyStarts, o) });
      }
      n = end;
    }
  }
  return scripts;
}

const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', '!', '{', '}']);

// The simple commands of a shell script, each a list of words
// { text, at, cut }: `at` is the offset where the word starts, and `cut`
// marks a word that ended inside quotes. Quotes are otherwise ignored. A
// command in `$(...)`, `(...)` or a backtick pair is a command of its own,
// and the word around it goes on after it.
function simpleCommands(script) {
  const commands = [];
  const frames = [];
  let words = [];
  let word = null;
  let quote = '';
  const take = (text, at) => {
    if (!word) word = { text: '', at, cut: false };
    word.text += text;
  };
  const endWord = () => {
    if (!word) return;
    word.cut = quote !== '';
    if (words.length || !RESERVED.has(word.text)) words.push(word);
    word = null;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  const open = (close) => {
    frames.push({ words, word, quote, close });
    words = [];
    word = null;
    quote = '';
  };
  const shut = (at) => {
    endCommand();
    ({ words, word, quote } = frames.pop());
    take('(…)', at);
  };
  for (let i = 0; i < script.length; i++) {
    const c = script[i];
    if (c === '\\' && quote !== "'") {
      if (script[i + 1] === '\n') i++;
      else if (i + 1 < script.length) take(script[++i], i - 1);
      continue;
    }
    if (c === quote) {
      quote = '';
    } else if (!quote && (c === '"' || c === "'")) {
      quote = c;
      take('', i);
    } else if (!quote && c === '#' && !word) {
      while (i + 1 < script.length && script[i + 1] !== '\n') i++;
    } else if (c === '(') {
      open(')');
    } else if (c === ')' || c === '`') {
      if (frames.at(-1)?.close === c) shut(i);
      else if (c === '`') open('`');
      else endCommand();
    } else if (c === '&' && /[<>]$/.test(word?.text ?? '')) {
      take(c, i);
    } else if (c === '\n' || c === ';' || c === '&' || c === '|') {
      endCommand();
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      take(c, i);
    }
  }
  endCommand();
  while (frames.length) {
    ({ words, word, quote } = frames.pop());
    endCommand();
  }
  return commands;
}

const ASSIGNMENT = /^([A-Za-z_]\w*)=([\s\S]*)$/;
const REDIRECT = /^\d*(?:[<>]|&>)/;
const REDIRECT_ALONE = /^\d*(?:[<>]{1,2}|[<>]&|<>|>\||&>>?)$/;

const namesHackmyagent = (text) =>
  text.split('/').some((segment) => segment.replace(/@[^@]*$/, '') === 'hackmyagent');

// Whether the words in front of a call leave OPENA2A_TELEMETRY=off in its
// environment: the assignments and redirections that start the command, and
// those after `env` and its options. An assignment cut inside quotes is not
// the switch, because its value goes on past the cut.
function carriesSwitch(prefix) {
  let off = false;
  let i = 0;
  for (;;) {
    for (; i < prefix.length; i++) {
      const { text, cut } = prefix[i];
      const assignment = ASSIGNMENT.exec(text);
      if (assignment) {
        if (assignment[1] === SWITCH) off = assignment[2] === 'off' && !cut;
      } else if (REDIRECT_ALONE.test(text)) {
        i++;
      } else if (!REDIRECT.test(text)) {
        break;
      }
    }
    if (i >= prefix.length || path.posix.basename(prefix[i].text) !== 'env') return off;
    for (i++; i < prefix.length && prefix[i].text.startsWith('-'); i++) {
      const option = prefix[i].text;
      if (option === '-' || option === '-i' || option === '--ignore-environment') off = false;
      else if (option === '-u' || option === '--unset') { if (prefix[++i]?.text === SWITCH) off = false; }
      else if (option === `-u${SWITCH}` || option === `--unset=${SWITCH}`) off = false;
    }
  }
}

// Each hackmyagent call in a Dockerfile's RUN steps: { line, text, off }.
function hackmyagentCalls(source) {
  const calls = [];
  for (const script of runScripts(source)) {
    for (const words of simpleCommands(script.text)) {
      words.forEach((word, k) => {
        if (!namesHackmyagent(word.text)) return;
        calls.push({ line: script.lineAt(word.at), text: word.text, off: carriesSwitch(words.slice(0, k)) });
      });
    }
  }
  return calls;
}

const flaggedLines = (source) => hackmyagentCalls(source).filter((call) => !call.off).map((call) => call.line);

const HMA = 'node_modules/.bin/hackmyagent';

test('the check flags a hackmyagent call that runs without the switch', () => {
  const cases = [
    // [Dockerfile, lines flagged]
    [`RUN ${HMA} check-metadata`, [1]],
    // The switch on another command of the step, or outside the step.
    [`RUN OPENA2A_TELEMETRY=off npm ci && ${HMA} check-metadata`, [1]],
    [`RUN echo OPENA2A_TELEMETRY=off | ${HMA} check-metadata`, [1]],
    [`RUN export OPENA2A_TELEMETRY=off && ${HMA} check-metadata`, [1]],
    [`ENV OPENA2A_TELEMETRY=off\nRUN ${HMA} check-metadata`, [2]],
    [`ARG OPENA2A_TELEMETRY=off\nRUN ${HMA} check-metadata`, [2]],
    // Continuation lines: the call is reported on its own line.
    [`RUN mkdir -p /app/.hackmyagent-cache && \\\n    ${HMA} check-metadata \\\n      > /app/.hackmyagent-cache/check-metadata.json`, [2]],
    [`RUN OPENA2A_TELEMETRY=off npm ci && \\\n    ${HMA} check-metadata`, [2]],
    [`RUN npm ci && \\\n# warm the cache\n\n    ${HMA} check-metadata`, [4]],
    ['# escape=`\nRUN npm ci && `\n    ' + `${HMA} check-metadata`, [3]],
    // A command substitution is a command of its own, also inside quotes.
    [`RUN OPENA2A_TELEMETRY=off V=$(${HMA} --version) && echo "$V"`, [1]],
    [`RUN mkdir -p /c && \\\n    V=$(${HMA} --version | head -1) && \\\n    OPENA2A_TELEMETRY=off ${HMA} check-metadata > "/c/v$V.json"`, [2]],
    [`RUN V="$(${HMA} --version)"`, [1]],
    ['RUN echo `hackmyagent --version`', [1]],
    // Another value, a value cut by a quoted space, or cleared again by env.
    [`RUN OPENA2A_TELEMETRY=on ${HMA} check-metadata`, [1]],
    [`RUN OPENA2A_TELEMETRY=offline ${HMA} check-metadata`, [1]],
    [`RUN OPENA2A_TELEMETRY="off now" ${HMA} check-metadata`, [1]],
    [`RUN OPENA2A_TELEMETRY=off env -i PATH="$PATH" ${HMA} check-metadata`, [1]],
    [`RUN OPENA2A_TELEMETRY=off env -u OPENA2A_TELEMETRY ${HMA} check-metadata`, [1]],
    // Launchers, a path into the package, a quoted script and compound commands.
    ['RUN npx -y hackmyagent@latest check-metadata', [1]],
    ['RUN node node_modules/hackmyagent/dist/cli.js check-metadata', [1]],
    ['RUN sh -c "npm ci && hackmyagent check-metadata"', [1]],
    ['RUN (cd /app && hackmyagent check-metadata)', [1]],
    ['RUN if [ -d /app ]; then OPENA2A_TELEMETRY=off npm ci; hackmyagent check-metadata; fi', [1]],
    // Flags, ONBUILD, lower case, the exec form and a heredoc.
    ['run --mount=type=cache,target=/root/.npm --network=default hackmyagent check-metadata', [1]],
    ['ONBUILD RUN hackmyagent check-metadata', [1]],
    [`RUN ["${HMA}", "check-metadata"]`, [1]],
    ['RUN ["sh", "-c", "hackmyagent check-metadata"]', [1]],
    ['RUN ["env", "OPENA2A_TELEMETRY=off now", "hackmyagent", "check-metadata"]', [1]],
    [`RUN <<EOF\nnpm ci\n${HMA} check-metadata\nEOF`, [3]],
    // Each call counts on its own.
    [`RUN OPENA2A_TELEMETRY=off ${HMA} check-metadata\nRUN ${HMA} check-metadata`, [2]],
  ];
  for (const [source, lines] of cases) {
    assert.deepEqual(flaggedLines(source), lines, `not flagged as it should be:\n${source}`);
  }
});

test('the check passes a call that carries the switch, and words that are not a call', () => {
  const cases = [
    // [Dockerfile, calls read]
    [`RUN OPENA2A_TELEMETRY=off ${HMA} check-metadata`, 1],
    [`RUN OPENA2A_TELEMETRY=off \\\n    ${HMA} check-metadata`, 1],
    [`RUN NODE_ENV=production OPENA2A_TELEMETRY=off ${HMA} check-metadata`, 1],
    [`RUN OPENA2A_TELEMETRY="off" ${HMA} check-metadata 2>&1 | tee /tmp/check.log`, 1],
    [`RUN OPENA2A_TELEMETRY='off' >/dev/null ${HMA} check-metadata`, 1],
    [`RUN env OPENA2A_TELEMETRY=off ${HMA} check-metadata`, 1],
    ['RUN /usr/bin/env -u HOME OPENA2A_TELEMETRY=off npx -y hackmyagent@latest check-metadata', 1],
    ['RUN OPENA2A_TELEMETRY=off sh -c "hackmyagent check-metadata"', 1],
    [`RUN ["env", "OPENA2A_TELEMETRY=off", "${HMA}", "check-metadata"]`, 1],
    ['RUN if [ -d /app ]; then OPENA2A_TELEMETRY=off hackmyagent check-metadata; fi', 1],
    [`RUN <<EOF\nnpm ci\nOPENA2A_TELEMETRY=off ${HMA} check-metadata\nEOF`, 1],
    // The image build step: a command substitution and a continuation.
    [`RUN mkdir -p /c && \\\n    V=$(OPENA2A_TELEMETRY=off ${HMA} --version 2>&1 | head -1) && \\\n    OPENA2A_TELEMETRY=off ${HMA} check-metadata > "/c/v\${V}.json"`, 2],
    // Words that are not a call.
    ['RUN mkdir -p /app/.hackmyagent-cache && chown node:node /app/.hackmyagent-cache', 0],
    ['RUN npm ci # hackmyagent runs when the container starts', 0],
    ['# hackmyagent check-metadata warms the cache\nCOPY hackmyagent.json ./\nLABEL scanner="hackmyagent"', 0],
  ];
  for (const [source, count] of cases) {
    const calls = hackmyagentCalls(source);
    assert.equal(calls.length, count, `${calls.length} calls read, not ${count}:\n${source}`);
    assert.deepEqual(flaggedLines(source), [], `flagged but carries the switch:\n${source}`);
  }
});

test('the walk reaches the image Dockerfile and the scenario Dockerfiles', () => {
  const files = walk(REPO_ROOT);
  assert.ok(files.includes('Dockerfile'), 'Dockerfile not walked');
  assert.ok(files.some((f) => f.startsWith(`scenarios${path.sep}`)), 'no scenarios/ Dockerfile walked');
  const calls = hackmyagentCalls(fs.readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8'));
  assert.ok(calls.length > 0, 'no hackmyagent call read from Dockerfile, so its build step is not checked');
});

test('every hackmyagent call in a Dockerfile RUN step carries OPENA2A_TELEMETRY=off', () => {
  const hits = [];
  for (const rel of walk(REPO_ROOT)) {
    for (const call of hackmyagentCalls(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'))) {
      if (!call.off) hits.push(`${rel}:${call.line}: ${call.text}`);
    }
  }
  assert.deepEqual(hits, [], `start each call's command with OPENA2A_TELEMETRY=off, on the command and not as an ENV:\n${hits.join('\n')}`);
});
