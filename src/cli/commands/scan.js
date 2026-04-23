/**
 * dvaa scan <scenario> — reuse dashboard scanner.js logic to run HMA against
 * scenarios/<name>/vulnerable/, print expected/fired/missing diff.
 *
 * --fix: run with HMA auto-fix + baseline diff (same flow as dashboard /fix).
 * --list: enumerate all scenarios + their expected checks.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runScan } from '../../dashboard/scanner.js';
import { emit, isJsonMode, splitArgs, tableRows, fail } from '../format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, '../../..');

export default async function run(argv) {
  const { positional, flags } = splitArgs(argv);
  if (flags.has('help') || flags.has('h')) {
    console.log(USAGE);
    return 0;
  }

  if (flags.has('list')) {
    return listScenarios(argv);
  }

  const name = positional[0];
  if (!name) {
    process.stderr.write('Missing scenario name. Usage: dvaa scan <name> | dvaa scan --list\n');
    return 1;
  }

  const scenarioDir = path.join(PKG_ROOT, 'scenarios', name);
  if (!fs.existsSync(scenarioDir)) {
    fail(`Scenario not found: ${name}\nRun: dvaa scan --list`);
  }
  const checksPath = path.join(scenarioDir, 'expected-checks.json');
  if (!fs.existsSync(checksPath)) {
    fail(`Scenario ${name} has no expected-checks.json (view-only scenario). Nothing to verify.`);
  }
  const expected = JSON.parse(fs.readFileSync(checksPath, 'utf-8'));
  if (!Array.isArray(expected) || expected.length === 0) {
    fail(`Scenario ${name} has an empty expected-checks.json. Nothing to verify.`);
  }

  try {
    const result = await runScan({
      pkgRoot: PKG_ROOT,
      name,
      expected,
      fix: flags.has('fix'),
    });
    renderResult(result, argv);
    return result.missing.length === 0 && !flags.has('fix') ? 0 : (flags.has('fix') ? 0 : 1);
  } catch (err) {
    fail(`Scan failed: ${err.message}`);
  }
}

function renderResult(result, argv) {
  if (isJsonMode(argv)) {
    emit(result, argv);
    return;
  }
  const header = result.fix
    ? `Fix run · ${result.fired.length} still firing, ${result.expectedDetail.filter(d => d.status === 'fixed').length} resolved`
    : result.missing.length === 0
      ? `PASS · all ${result.expected.length} expected check(s) fired (${result.durationMs}ms)`
      : `PARTIAL · ${result.fired.length} of ${result.expected.length} expected check(s) fired (${result.durationMs}ms)`;
  const lines = [header, ''];
  for (const d of result.expectedDetail) {
    const marker = d.status === 'fired' ? '●' : d.status === 'fixed' ? '✓' : '✕';
    const head = `  ${marker} ${d.checkId.padEnd(18)} ${d.status.padEnd(8)} ${d.name || ''}`;
    lines.push(head);
    if (d.file) lines.push(`    in ${d.file}`);
    if (d.guidance) lines.push(`    ${d.guidance}`);
    if (d.status === 'missing' && d.diagnostic) lines.push(`    hint: ${d.diagnostic}`);
    lines.push('');
  }
  lines.push(`${result.allFindingsCount} total HMA findings across the fixture.`);
  emit(lines, argv);
}

function listScenarios(argv) {
  const dir = path.join(PKG_ROOT, 'scenarios');
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'examples') continue;
    const checksPath = path.join(dir, entry.name, 'expected-checks.json');
    let expected = [];
    try { expected = JSON.parse(fs.readFileSync(checksPath, 'utf-8')); } catch { /* missing */ }
    rows.push({
      name: entry.name,
      checks: Array.isArray(expected) && expected.length ? expected.join(',') : '(view-only)',
      count: Array.isArray(expected) ? expected.length : 0,
    });
  }
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  if (isJsonMode(argv)) {
    emit(rows, argv);
    return 0;
  }
  emit([
    `${rows.length} scenarios (${rows.filter(r => r.count > 0).length} scannable):`,
    '',
    ...tableRows(rows, [
      { key: 'name',   header: 'SCENARIO' },
      { key: 'count',  header: 'N' },
      { key: 'checks', header: 'EXPECTED CHECKS' },
    ]),
  ], argv);
  return 0;
}

const USAGE = `Usage: dvaa scan <scenario> [--fix] [--json]
       dvaa scan --list [--json]

Run HackMyAgent against a DVAA scenario fixture and diff findings against
scenarios/<name>/expected-checks.json.

Options:
  --fix     Run HMA with --fix and report before/after diff
  --list    Print all 86 scenarios and their expected checks
  --json    Machine-readable output
  --help    Show this message`;
