/**
 * Scenarios view -- browse infrastructure vulnerability scenarios
 */
import { el } from '../utils.js';
import { codeBlock, openModal } from '../components.js';
import { verifyScenario } from '../api.js';

export function renderScenarios(state) {
  const wrap = el('div');
  const scenarios = state.scenarios || [];

  wrap.appendChild(el('div', { className: 'section-header' }, `Infrastructure Scenarios (${scenarios.length})`));
  wrap.appendChild(el('p', { className: 'section-desc' },
    'Real-world AI infrastructure misconfigurations discovered by security research. Each scenario reproduces a specific vulnerability you can scan, fix, and verify with HackMyAgent.'));

  // Progress summary bar
  const completedScenarios = scenarios.filter(s => s.completed);
  const totalPoints = scenarios.reduce((sum, s) => sum + (s.points || 0), 0);
  const earnedPoints = completedScenarios.reduce((sum, s) => sum + (s.completed?.points || s.points || 0), 0);
  const pct = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;

  const scoreboard = el('div', { className: 'challenge-scoreboard' });
  scoreboard.appendChild(el('div', { className: 'scoreboard-points' },
    `${earnedPoints.toLocaleString()}`,
    el('span', {}, ` / ${totalPoints.toLocaleString()} points`)
  ));
  const bar = el('div', { className: 'progress-bar' });
  const fill = el('div', { className: 'progress-fill' });
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  scoreboard.appendChild(bar);
  scoreboard.appendChild(el('div', { className: 'scoreboard-count' },
    `${completedScenarios.length} / ${scenarios.length} completed`));
  wrap.appendChild(scoreboard);

  // Group by severity
  const severityOrder = ['critical', 'high', 'medium', 'low'];
  const severityLabels = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

  for (const severity of severityOrder) {
    const group = scenarios.filter(s => s.severity === severity);
    if (group.length === 0) continue;

    wrap.appendChild(el('div', { className: 'section-header section-header-sm' },
      `${severityLabels[severity]} (${group.length})`));

    const grid = el('div', { className: 'scenario-grid' });
    for (const scenario of group) {
      grid.appendChild(scenarioTile(scenario));
    }
    wrap.appendChild(grid);
  }

  // Show unknown severity scenarios if any
  const unknown = scenarios.filter(s => !severityOrder.includes(s.severity));
  if (unknown.length > 0) {
    wrap.appendChild(el('div', { className: 'section-header section-header-sm' },
      `Other (${unknown.length})`));
    const grid = el('div', { className: 'scenario-grid' });
    for (const scenario of unknown) {
      grid.appendChild(scenarioTile(scenario));
    }
    wrap.appendChild(grid);
  }

  return wrap;
}

function scenarioTile(scenario) {
  const isCompleted = !!scenario.completed;
  const tile = el('div', { className: `scenario-tile severity-${scenario.severity}${isCompleted ? ' completed' : ''}` });

  // Header
  const header = el('div', { className: 'scenario-header' });
  header.appendChild(el('span', { className: 'scenario-name' }, scenario.name));
  if (scenario.checkId) {
    header.appendChild(el('span', { className: 'badge badge-category' }, scenario.checkId));
  }
  if (isCompleted) {
    header.appendChild(el('span', { className: 'scenario-completed-badge' }, `[done] +${scenario.completed.points}pts`));
  }
  tile.appendChild(header);

  // Title + description
  tile.appendChild(el('div', { className: 'scenario-title' }, scenario.title));
  if (scenario.description) {
    tile.appendChild(el('div', { className: 'scenario-desc' }, scenario.description));
  }

  // Meta row
  const meta = el('div', { className: 'scenario-meta' });
  meta.appendChild(el('span', { className: `badge badge-security badge-${scenario.severity}` }, scenario.severity));
  if (scenario.autoFix) {
    meta.appendChild(el('span', { className: 'badge badge-autofix' }, 'Auto-Fix'));
  }
  if (scenario.points) {
    meta.appendChild(el('span', { className: 'badge badge-category' }, `${scenario.points} pts`));
  }
  tile.appendChild(meta);

  // Click to open detail modal
  tile.addEventListener('click', () => {
    openModal(`${scenario.name}: ${scenario.title}`, scenarioDetailModal(scenario));
  });

  return tile;
}

function scenarioDetailModal(scenario) {
  const detail = el('div');

  if (scenario.completed) {
    const completedBanner = el('div', { className: 'verify-result success', style: { marginBottom: '0.75rem' } },
      `Completed! +${scenario.completed.points} points`);
    detail.appendChild(completedBanner);
  }

  if (scenario.description) {
    detail.appendChild(el('p', { className: 'scenario-desc' }, scenario.description));
  }

  detail.appendChild(el('p', { style: { fontWeight: '600', marginTop: '0.75rem', fontSize: '0.85rem' } }, 'Detect:'));
  detail.appendChild(codeBlock(`npx hackmyagent secure scenarios/${scenario.name}/vulnerable`));

  if (scenario.autoFix) {
    detail.appendChild(el('p', { style: { fontWeight: '600', marginTop: '0.75rem', fontSize: '0.85rem' } }, 'Fix:'));
    detail.appendChild(codeBlock(`npx hackmyagent secure scenarios/${scenario.name}/vulnerable --fix`));
  }

  if (scenario.expectedChecks && scenario.expectedChecks.length > 0) {
    detail.appendChild(el('p', { style: { fontWeight: '600', marginTop: '0.75rem', fontSize: '0.85rem' } }, 'Expected Checks:'));
    const checksWrap = el('div', { className: 'hma-checks' });
    for (const c of scenario.expectedChecks) {
      checksWrap.appendChild(el('span', { className: 'hma-check' }, c));
    }
    detail.appendChild(checksWrap);
  }

  // Verify section
  detail.appendChild(el('p', { style: { fontWeight: '600', marginTop: '1rem', fontSize: '0.85rem' } }, 'Verify Scan Results:'));
  const verifySection = el('div', { className: 'verify-section' });
  const input = el('textarea', {
    className: 'verify-input',
    placeholder: 'Paste HMA JSON output here...',
    rows: '4',
  });
  const verifyBtn = el('button', { className: 'btn btn-primary' }, 'Verify');
  verifySection.appendChild(input);
  verifySection.appendChild(verifyBtn);
  detail.appendChild(verifySection);

  const resultDiv = el('div');
  detail.appendChild(resultDiv);

  verifyBtn.addEventListener('click', async () => {
    const raw = input.value.trim();
    if (!raw) return;
    verifyBtn.textContent = '...';
    verifyBtn.disabled = true;
    try {
      const hmaOutput = JSON.parse(raw);
      const findings = (hmaOutput.findings || []).map(f => f.checkId);

      const result = await verifyScenario(scenario.name, findings);
      const resultEl = el('div', {
        className: `verify-result ${result.success ? 'success' : 'failure'}`,
      }, result.success
        ? `Completed! +${result.points} points`
        : `${result.message}`
      );
      resultDiv.replaceChildren(resultEl);
    } catch (err) {
      resultDiv.replaceChildren(el('div', { className: 'verify-result failure' },
        'Could not parse HMA output. Paste the full JSON from: npx hackmyagent secure <dir> --json'));
    }
    verifyBtn.textContent = 'Verify';
    verifyBtn.disabled = false;
  });

  return detail;
}
