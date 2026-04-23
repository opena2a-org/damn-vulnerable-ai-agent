/**
 * Scenarios view — Scenarios v2
 *
 * Dashboard-initiated HMA scans. Each card owns its own scan/fix state, and
 * the view is registered as an interactive view (see app.js) so the 2s data
 * poll won't clobber an open result panel.
 */
import { el } from '../utils.js';
import { openModal, closeModal } from '../components.js';
import { scanScenario, fixScenario, fetchScenarios, listScenarioFiles, readScenarioFile } from '../api.js';

// Filter / sort state persists for the lifetime of the page. Scenarios view
// is interactive, so re-renders only happen on explicit user action.
const viewState = {
  severity: 'all',       // 'all' | 'critical' | 'high' | 'medium' | 'low'
  autoFix: 'all',        // 'all' | 'autofix' | 'manual'
  done: 'all',           // 'all' | 'done' | 'todo'
  sort: 'severity',      // 'severity' | 'points' | 'alpha'
};

// Inline scan results keyed by scenario name. Survives re-render because state
// is module-scope, not view-scope.
const scanResults = new Map();   // name -> { result, error, fix }

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
const SEVERITY_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', unknown: 'Other' };

export function renderScenarios(state) {
  const wrap = el('div');
  const scenarios = state.scenarios || [];

  wrap.appendChild(el('div', { className: 'section-header' }, `Infrastructure Scenarios (${scenarios.length})`));
  wrap.appendChild(el('p', { className: 'section-desc' },
    'Real-world AI infrastructure misconfigurations. Click Scan to run HackMyAgent against a scenario and see what it detects. Click Apply Fix to remediate and re-scan.'));

  wrap.appendChild(renderProgress(scenarios));
  wrap.appendChild(renderFilterBar(state));

  const filtered = applyFilters(scenarios);
  if (filtered.length === 0) {
    wrap.appendChild(el('p', { className: 'section-desc', style: { textAlign: 'center', padding: '2rem' } },
      'No scenarios match the current filters.'));
    return wrap;
  }

  // Group by severity for headers, but skip grouping when user picked a single severity.
  if (viewState.severity !== 'all' || viewState.sort !== 'severity') {
    wrap.appendChild(renderGrid(filtered, state));
  } else {
    for (const sev of ['critical', 'high', 'medium', 'low', 'unknown']) {
      const group = filtered.filter(s => (s.severity || 'unknown') === sev);
      if (group.length === 0) continue;
      wrap.appendChild(el('div', { className: 'section-header section-header-sm' },
        `${SEVERITY_LABEL[sev]} (${group.length})`));
      wrap.appendChild(renderGrid(group, state));
    }
  }

  return wrap;
}

function renderProgress(scenarios) {
  const completed = scenarios.filter(s => s.completed);
  const totalPoints = scenarios.reduce((sum, s) => sum + (s.points || 0), 0);
  const earned = completed.reduce((sum, s) => sum + (s.completed?.points || s.points || 0), 0);
  const pct = totalPoints > 0 ? (earned / totalPoints) * 100 : 0;

  const scoreboard = el('div', { className: 'challenge-scoreboard' });
  scoreboard.appendChild(el('div', { className: 'scoreboard-points' },
    `${earned.toLocaleString()}`,
    el('span', {}, ` / ${totalPoints.toLocaleString()} points`)
  ));
  const bar = el('div', { className: 'progress-bar' });
  const fill = el('div', { className: 'progress-fill' });
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  scoreboard.appendChild(bar);
  scoreboard.appendChild(el('div', { className: 'scoreboard-count' },
    `${completed.length} / ${scenarios.length} completed`));
  return scoreboard;
}

function renderFilterBar(state) {
  const bar = el('div', { className: 'scenario-filters' });

  bar.appendChild(filterGroup('Severity', [
    ['all', 'All'],
    ['critical', 'Critical'],
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
  ], viewState.severity, v => { viewState.severity = v; rerender(state); }));

  bar.appendChild(filterGroup('Fix', [
    ['all', 'All'],
    ['autofix', 'Auto-fixable'],
    ['manual', 'Manual'],
  ], viewState.autoFix, v => { viewState.autoFix = v; rerender(state); }));

  bar.appendChild(filterGroup('Progress', [
    ['all', 'All'],
    ['todo', 'Not done'],
    ['done', 'Done'],
  ], viewState.done, v => { viewState.done = v; rerender(state); }));

  bar.appendChild(filterGroup('Sort', [
    ['severity', 'Severity'],
    ['points', 'Points'],
    ['alpha', 'A–Z'],
  ], viewState.sort, v => { viewState.sort = v; rerender(state); }));

  return bar;
}

function filterGroup(label, options, active, onChange) {
  const group = el('div', { className: 'scenario-filter-group' });
  group.appendChild(el('span', { className: 'scenario-filter-label' }, label));
  for (const [value, text] of options) {
    const chip = el('button', {
      className: `scenario-filter-chip${active === value ? ' active' : ''}`,
      onClick: () => onChange(value),
    }, text);
    group.appendChild(chip);
  }
  return group;
}

function applyFilters(scenarios) {
  let out = scenarios.slice();
  if (viewState.severity !== 'all') {
    out = out.filter(s => s.severity === viewState.severity);
  }
  if (viewState.autoFix === 'autofix') out = out.filter(s => s.autoFix);
  if (viewState.autoFix === 'manual') out = out.filter(s => !s.autoFix);
  if (viewState.done === 'done') out = out.filter(s => s.completed);
  if (viewState.done === 'todo') out = out.filter(s => !s.completed);

  if (viewState.sort === 'severity') {
    out.sort((a, b) =>
      (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4)
      || a.name.localeCompare(b.name));
  } else if (viewState.sort === 'points') {
    out.sort((a, b) => (b.points || 0) - (a.points || 0) || a.name.localeCompare(b.name));
  } else if (viewState.sort === 'alpha') {
    out.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

function renderGrid(scenarios, state) {
  const grid = el('div', { className: 'scenario-grid' });
  for (const scenario of scenarios) {
    grid.appendChild(scenarioCard(scenario, state));
  }
  return grid;
}

function scenarioCard(scenario, state) {
  const isCompleted = !!scenario.completed;
  const card = el('div', {
    className: `scenario-card severity-${scenario.severity || 'unknown'}${isCompleted ? ' completed' : ''}`,
  });

  // Top row: severity dot + "detects: ..." + completion checkmark
  const topRow = el('div', { className: 'scenario-card-top' });
  topRow.appendChild(severityTag(scenario.severity));
  if (scenario.expectedChecks && scenario.expectedChecks.length > 0) {
    topRow.appendChild(el('span', { className: 'scenario-detects' },
      'detects ',
      el('span', { className: 'scenario-detects-ids' }, scenario.expectedChecks.join(', '))));
  }
  if (isCompleted) {
    topRow.appendChild(el('span', { className: 'scenario-complete-mark', title: 'Completed' }, '✓'));
  }
  card.appendChild(topRow);

  // Title
  card.appendChild(el('div', { className: 'scenario-title' }, scenario.title));

  // Description (clamped to 3 lines via CSS)
  if (scenario.description) {
    card.appendChild(el('p', { className: 'scenario-desc' }, scenario.description));
  }

  // Meta line: auto-fix · points · slug
  const meta = el('div', { className: 'scenario-meta' });
  if (scenario.autoFix) {
    meta.appendChild(el('span', { className: 'scenario-meta-autofix' }, 'auto-fix'));
    meta.appendChild(el('span', { className: 'scenario-meta-sep' }, '·'));
  }
  if (scenario.points) {
    const pointsLabel = isCompleted
      ? `+${scenario.completed.points} earned`
      : `${scenario.points} pts`;
    meta.appendChild(el('span', { className: 'scenario-meta-points' }, pointsLabel));
    meta.appendChild(el('span', { className: 'scenario-meta-sep' }, '·'));
  }
  meta.appendChild(el('span', { className: 'scenario-meta-slug' }, scenario.name));
  card.appendChild(meta);

  // Action row. Scenarios without expected-checks.json can't be verified, so
  // the scan button would just error — show Details only in that case.
  const hasExpected = scenario.expectedChecks && scenario.expectedChecks.length > 0;
  const actions = el('div', { className: 'scenario-actions' });
  const scanBtn = hasExpected ? el('button', { className: 'btn btn-primary btn-sm' }, 'Scan scenario') : null;
  const detailsBtn = el('button', { className: 'btn btn-secondary btn-sm' }, 'Details');
  if (scanBtn) actions.appendChild(scanBtn);
  actions.appendChild(detailsBtn);
  card.appendChild(actions);

  // Inline result panel slot
  const panel = el('div', { className: 'scenario-panel' });
  card.appendChild(panel);

  // Restore prior scan result if we have one (survives re-render)
  const prior = scanResults.get(scenario.name);
  if (prior) {
    panel.replaceChildren(renderPanel(scenario, prior, { scanBtn, state, panel }));
    card.classList.add('expanded');
  }

  if (scanBtn) {
    scanBtn.addEventListener('click', () => runScanFlow(scenario, { scanBtn, panel, card, state, fix: false }));
  }
  detailsBtn.addEventListener('click', () => openModal(
    `${scenario.name}: ${scenario.title}`,
    scenarioDetailModal(scenario, { scanBtn, panel, card, state })
  ));

  return card;
}

function severityTag(severity) {
  const sev = severity || 'unknown';
  const wrap = el('span', { className: `scenario-severity sev-${sev}` });
  wrap.appendChild(el('span', { className: 'scenario-severity-dot' }));
  wrap.appendChild(el('span', { className: 'scenario-severity-label' }, sev));
  return wrap;
}

async function runScanFlow(scenario, ctx) {
  const { scanBtn, panel, card, state, fix } = ctx;
  const label = scanBtn.textContent;
  scanBtn.disabled = true;
  scanBtn.textContent = fix ? 'Applying fix…' : 'Scanning…';
  card.classList.add('expanded');

  panel.replaceChildren(el('div', { className: 'scenario-panel-loading' },
    fix ? 'Running HackMyAgent with --fix…' : 'Running HackMyAgent against scenarios/' + scenario.name + '/vulnerable/ …'));

  try {
    const result = fix
      ? await fixScenario(scenario.name)
      : await scanScenario(scenario.name);
    scanResults.set(scenario.name, { result, error: null, fix });
    panel.replaceChildren(renderPanel(scenario, { result, fix }, { scanBtn, state, panel }));

    // On successful (non-fix) scan that completes the scenario, refresh state
    // so progress bar + card state update without waiting for the next poll.
    if (!fix && result.completed) {
      fetchScenarios().then(list => { state.scenarios = list; }).catch(() => {});
    }
  } catch (err) {
    scanResults.set(scenario.name, { result: null, error: err.message || 'Scan failed', fix });
    panel.replaceChildren(el('div', { className: 'scenario-panel-error' },
      'Scan failed: ' + (err.message || String(err))));
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = label;
  }
}

function renderPanel(scenario, { result, error, fix }, ctx) {
  if (error) {
    return el('div', { className: 'scenario-panel-error' }, 'Scan failed: ' + error);
  }
  if (!result) return el('div');

  const panel = el('div', { className: 'scenario-result' });

  // Remediation celebration banner — user just ran --fix and everything that
  // was broken is now passing. Explicit, green, separate from the scan line.
  const resolvedCount = result.expectedDetail.filter(d => d.status === 'fixed').length;
  if (fix && result.fired.length === 0 && resolvedCount > 0) {
    panel.appendChild(el('div', { className: 'scenario-result-banner ok' },
      el('span', { className: 'scenario-result-banner-mark' }, '✓'),
      el('div', {},
        el('div', { className: 'scenario-result-banner-title' },
          `Remediated · ${resolvedCount} previously-firing check(s) now pass`),
        el('div', { className: 'scenario-result-banner-sub' },
          'HackMyAgent auto-fix modified the vulnerable files to close the finding. Re-scan to confirm.'))
    ));
  }

  // Header
  const status = fix
    ? `Fix applied · ${result.fired.length} still firing, ${resolvedCount} resolved`
    : result.missing.length === 0
      ? `All ${result.expected.length} expected check(s) fired ${result.completed ? `· +${result.completed.points} earned` : ''}`
      : `${result.fired.length} of ${result.expected.length} expected check(s) fired`;

  panel.appendChild(el('div', { className: 'scenario-result-header' },
    el('span', { className: `scenario-result-status ${result.missing.length === 0 && !fix ? 'ok' : 'partial'}` }, status),
    el('span', { className: 'scenario-result-meta' },
      `${result.durationMs}ms · ${result.allFindingsCount} total HMA findings`)
  ));

  // Per-expected-check detail list
  const list = el('div', { className: 'scenario-result-list' });
  for (const d of result.expectedDetail) {
    list.appendChild(renderFindingRow(d));
  }
  panel.appendChild(list);

  // Action row inside the panel
  const actions = el('div', { className: 'scenario-result-actions' });
  const rescanBtn = el('button', { className: 'btn btn-primary btn-sm' }, 'Re-scan');
  actions.appendChild(rescanBtn);
  rescanBtn.addEventListener('click', () => runScanFlow(scenario, {
    scanBtn: rescanBtn, panel: ctx.panel, card: ctx.panel.parentElement, state: ctx.state, fix: false,
  }));

  if (scenario.autoFix && result.fired.length > 0 && !fix) {
    const fixBtn = el('button', { className: 'btn btn-warning btn-sm' }, 'Apply fix');
    fixBtn.addEventListener('click', () => {
      const ok = confirm(
        `Apply HackMyAgent auto-fix to scenarios/${scenario.name}/vulnerable/?\n\n` +
        `This modifies files. In Docker the changes are ephemeral (reset on restart). ` +
        `Running DVAA from a clone? Use \`git checkout scenarios/${scenario.name}/vulnerable/\` to reset.`
      );
      if (!ok) return;
      runScanFlow(scenario, {
        scanBtn: fixBtn, panel: ctx.panel, card: ctx.panel.parentElement, state: ctx.state, fix: true,
      });
    });
    actions.appendChild(fixBtn);
  }

  const closeBtn = el('button', { className: 'btn btn-ghost btn-sm' }, 'Close');
  closeBtn.addEventListener('click', () => {
    scanResults.delete(scenario.name);
    ctx.panel.replaceChildren();
    ctx.panel.parentElement.classList.remove('expanded');
  });
  actions.appendChild(closeBtn);
  panel.appendChild(actions);

  return panel;
}

function renderFindingRow(d) {
  const row = el('div', { className: `scenario-finding status-${d.status}` });

  const marker = d.status === 'fired' ? '●'
    : d.status === 'fixed' ? '✓'
    : '✕';
  row.appendChild(el('span', { className: 'scenario-finding-marker' }, marker));

  const body = el('div', { className: 'scenario-finding-body' });
  body.appendChild(el('div', { className: 'scenario-finding-head' },
    el('span', { className: 'scenario-finding-id' }, d.checkId),
    el('span', { className: 'scenario-finding-name' }, d.name || '')
  ));

  if (d.status === 'fired') {
    if (d.file) body.appendChild(el('div', { className: 'scenario-finding-file' }, `in ${d.file}`));
    if (d.guidance) body.appendChild(el('div', { className: 'scenario-finding-guidance' }, d.guidance));
  } else if (d.status === 'fixed') {
    body.appendChild(el('div', { className: 'scenario-finding-guidance' },
      'Was firing before the fix, now passes.'));
  } else {
    // Missing. Surface whatever we can — HMA registry metadata (description +
    // severity) plus the family-based diagnostic hint.
    if (d.severity || d.category) {
      const meta = el('div', { className: 'scenario-finding-file' });
      if (d.severity) meta.appendChild(document.createTextNode(`severity ${d.severity}`));
      if (d.category) meta.appendChild(document.createTextNode(`${d.severity ? ' · ' : ''}category ${d.category}`));
      body.appendChild(meta);
    }
    if (d.guidance) {
      body.appendChild(el('div', { className: 'scenario-finding-guidance' }, d.guidance));
    }
    body.appendChild(el('div', { className: 'scenario-finding-guidance scenario-finding-diag' },
      d.diagnostic || 'This check was expected but did not fire.'));
    if (!d.inRegistry) {
      body.appendChild(el('div', { className: 'scenario-finding-guidance scenario-finding-diag' },
        `${d.checkId} isn't in this HMA version's check-metadata output — the check may have been renamed or removed upstream.`));
    }
  }
  row.appendChild(body);
  return row;
}

function scenarioDetailModal(scenario, ctx) {
  const detail = el('div', { className: 'scenario-detail' });
  const sections = scenario.sections || {};

  // Header strip: completion banner OR coverage note
  if (scenario.completed) {
    detail.appendChild(el('div', { className: 'verify-result success', style: { marginBottom: '0.75rem' } },
      `Completed · +${scenario.completed.points} points`));
  } else if (sections.detectionStatus && (!scenario.expectedChecks || scenario.expectedChecks.length === 0)) {
    const ds = sections.detectionStatus;
    const note = el('div', { className: 'scenario-coverage-note' });
    note.appendChild(el('div', { className: 'scenario-coverage-head' }, 'HMA auto-detection not yet implemented'));
    if (ds.summary) note.appendChild(el('div', { className: 'scenario-coverage-body' }, ds.summary));
    if (ds.deferred && ds.deferred.length) {
      note.appendChild(el('div', { className: 'scenario-coverage-head scenario-coverage-head-sm' }, 'Deferred'));
      const ul = el('ul', { className: 'scenario-detail-list' });
      for (const d of ds.deferred) ul.appendChild(el('li', {}, d));
      note.appendChild(ul);
    }
    detail.appendChild(note);
  }

  // Meta row: OASB + check IDs
  const metaRow = el('div', { className: 'scenario-detail-meta' });
  if (scenario.oasbControl) {
    metaRow.appendChild(el('span', { className: 'scenario-detail-meta-item' }, 'OASB ', el('strong', {}, scenario.oasbControl)));
  }
  if (scenario.expectedChecks && scenario.expectedChecks.length > 0) {
    const checksBox = el('span', { className: 'scenario-detail-meta-item' }, 'detects ');
    for (const c of scenario.expectedChecks) {
      checksBox.appendChild(el('code', { className: 'inline-code', style: { marginLeft: '0.25rem' } }, c));
    }
    metaRow.appendChild(checksBox);
  }
  if (metaRow.children.length) detail.appendChild(metaRow);

  // Description
  if (scenario.description) {
    detail.appendChild(el('p', { className: 'scenario-detail-desc' }, scenario.description));
  }

  // Structured sections
  if (sections.attackVector && sections.attackVector.length) {
    detail.appendChild(sectionBlock('Attack vector', sections.attackVector, { ordered: true }));
  }
  if (sections.impact && sections.impact.length) {
    detail.appendChild(sectionBlock('Impact', sections.impact));
  }
  if (sections.remediation && sections.remediation.length) {
    detail.appendChild(sectionBlock('Remediation', sections.remediation));
  }

  // Demonstration code shipped with DVAA, not user-env files.
  const filesBlock = el('div', { className: 'scenario-detail-section' });
  const filesHead = el('div', { className: 'scenario-detail-section-head' }, 'Vulnerable files ',
    el('span', { className: 'scenario-detail-section-count' }, '(loading…)'));
  filesBlock.appendChild(filesHead);
  filesBlock.appendChild(el('div', { className: 'scenario-detail-section-note' },
    'Shipped with DVAA at ',
    el('code', { className: 'inline-code' }, `scenarios/${scenario.name}/vulnerable/`),
    '. Your own code is not touched.'));
  const filesList = el('div', { className: 'scenario-file-list' });
  filesBlock.appendChild(filesList);
  detail.appendChild(filesBlock);

  listScenarioFiles(scenario.name)
    .then(files => renderFileList(filesList, filesHead, scenario, files))
    .catch(err => {
      filesHead.replaceChildren('Vulnerable files ', el('span', { className: 'scenario-detail-section-count' }, '(unavailable)'));
      filesList.appendChild(el('div', { className: 'scenario-file-err' }, err.message || 'Could not list files.'));
    });

  // References
  if (sections.references && sections.references.length) {
    const refBlock = el('div', { className: 'scenario-detail-section' });
    refBlock.appendChild(el('div', { className: 'scenario-detail-section-head' }, 'References'));
    const ul = el('ul', { className: 'scenario-detail-list scenario-detail-refs' });
    for (const ref of sections.references) {
      const li = el('li');
      if (ref.url) {
        const a = el('a', { href: ref.url, target: '_blank', rel: 'noopener noreferrer' }, ref.text);
        a.appendChild(el('span', { className: 'scenario-detail-ref-arrow' }, ' ↗'));
        li.appendChild(a);
      } else {
        li.appendChild(document.createTextNode(ref.text));
      }
      ul.appendChild(li);
    }
    refBlock.appendChild(ul);
    detail.appendChild(refBlock);
  }

  // Action row
  const hasExpected = scenario.expectedChecks && scenario.expectedChecks.length > 0;
  const actions = el('div', { className: 'scenario-detail-actions' });
  if (hasExpected && ctx && ctx.card) {
    const scanFromModal = el('button', { className: 'btn btn-primary btn-sm' }, 'Scan scenario');
    scanFromModal.addEventListener('click', () => {
      closeModal();
      ctx.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      runScanFlow(scenario, { scanBtn: ctx.scanBtn, panel: ctx.panel, card: ctx.card, state: ctx.state, fix: false });
    });
    actions.appendChild(scanFromModal);
  }
  const closeBtn = el('button', { className: 'btn btn-ghost btn-sm' }, 'Close');
  closeBtn.addEventListener('click', () => closeModal());
  actions.appendChild(closeBtn);
  detail.appendChild(actions);

  return detail;
}

function sectionBlock(title, items, { ordered = false } = {}) {
  const block = el('div', { className: 'scenario-detail-section' });
  block.appendChild(el('div', { className: 'scenario-detail-section-head' }, title));
  const list = el(ordered ? 'ol' : 'ul', { className: 'scenario-detail-list' });
  for (const item of items) list.appendChild(el('li', {}, item));
  block.appendChild(list);
  return block;
}

function renderFileList(container, headerEl, scenario, files) {
  headerEl.replaceChildren('Vulnerable files ',
    el('span', { className: 'scenario-detail-section-count' }, `(${files.length})`));
  if (files.length === 0) {
    container.appendChild(el('div', { className: 'scenario-file-err' },
      'No vulnerable/ directory for this scenario.'));
    return;
  }
  for (const f of files) {
    const row = el('div', { className: 'scenario-file-row' });
    const summary = el('div', { className: 'scenario-file-summary' });
    summary.appendChild(el('span', { className: 'scenario-file-caret' }, '▸'));
    summary.appendChild(el('code', { className: 'scenario-file-path' }, f.path));
    summary.appendChild(el('span', { className: 'scenario-file-size' }, formatBytes(f.size)));
    row.appendChild(summary);

    const body = el('pre', { className: 'scenario-file-body' });
    let loaded = false;
    summary.addEventListener('click', async () => {
      if (row.classList.contains('open')) {
        row.classList.remove('open');
        return;
      }
      row.classList.add('open');
      if (loaded) return;
      body.textContent = 'Loading…';
      try {
        const data = await readScenarioFile(scenario.name, f.path);
        body.textContent = data.content;
        loaded = true;
      } catch (err) {
        body.textContent = err.message || 'Could not read file.';
      }
    });
    row.appendChild(body);
    container.appendChild(row);
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Force a re-render by manually re-running the view fn. We do this because
 * Scenarios is in INTERACTIVE_VIEWS — the 2s data poll skips it.
 */
function rerender(state) {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren(renderScenarios(state));
}
