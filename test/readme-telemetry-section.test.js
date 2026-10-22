/**
 * README §Telemetry is a privacy disclosure: its "Sent" list has to name what
 * the code sends. These checks pin that list to the code it describes, so a
 * new dashboard action, a new subcommand or a new event kind cannot ship
 * without the README saying so.
 *
 * Network-free: reads README.md and imports the dashboard allowlist and the
 * command table. Nothing here initialises the telemetry SDK.
 */

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { USER_ACTIONS } from '../src/telemetry/actions.js';
import { listCommands } from '../src/cli/router.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The text of README.md from "## Telemetry" up to the next "## " heading. */
function telemetrySection() {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf-8');
  const start = readme.indexOf('\n## Telemetry\n');
  assert.ok(start >= 0, 'README.md should have a "## Telemetry" section');
  const body = readme.slice(start + 1);
  const next = body.indexOf('\n## ');
  return next >= 0 ? body.slice(0, next) : body;
}

/** True when the section names `name` in code font, with or without a `dvaa ` prefix. */
function names(section, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('`(dvaa )?' + escaped + '`').test(section);
}

test('README §Telemetry names each dashboard action in the telemetry allowlist', () => {
  const section = telemetrySection();
  assert.ok(USER_ACTIONS.length > 0, 'the allowlist should not be empty');
  for (const { name } of USER_ACTIONS) {
    assert.ok(
      names(section, name),
      `README §Telemetry should name the dashboard action \`${name}\` from src/telemetry/actions.js; update the "Sent" list when the allowlist changes`,
    );
  }
});

test('README §Telemetry names each kind of event the telemetry SDK sends', () => {
  const section = telemetrySection();
  // @opena2a/telemetry builds exactly these: start(), track() and error().
  for (const kind of ['start', 'command', 'error']) {
    assert.ok(names(section, kind), `README §Telemetry should name the \`${kind}\` event`);
  }
});

test('README §Telemetry says whether each dispatched subcommand sends an event', () => {
  const section = telemetrySection();
  // src/cli/router.js tracks every subcommand it dispatches except `telemetry`;
  // `selftest` is dispatched by src/index.js without tracking. The README has
  // to say which is which, so each listed name must appear in the section.
  const commands = listCommands();
  assert.ok(commands.length > 0, 'the command table should not be empty');
  for (const { name } of commands) {
    assert.ok(
      names(section, name),
      `README §Telemetry should say whether \`dvaa ${name}\` sends an event; update the "Sent" list when a subcommand is added`,
    );
  }
});
