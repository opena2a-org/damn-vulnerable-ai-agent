/**
 * .gitignore pattern hygiene (#132).
 *
 * Git treats `#` as a comment only at the start of a line. A pattern followed
 * by a comment on the same line (`.dvaa/   # scoreboard`) is one pattern that
 * includes the comment text, so it matches nothing and the path it meant to
 * ignore shows up as untracked. Reads the file directly; needs no git.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('no .gitignore pattern carries a trailing comment', () => {
  const lines = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf-8').split(/\r?\n/);
  const offenders = lines
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => !text.startsWith('#') && /(^|[^\\])\s#/.test(text));
  assert.deepStrictEqual(
    offenders, [],
    `.gitignore lines with a trailing comment ignore nothing; move each comment to its own line above the pattern:\n${
      offenders.map(o => `  ${o.line}: ${o.text}`).join('\n')}`,
  );
});
