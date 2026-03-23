/**
 * Scenarios view -- browse infrastructure vulnerability scenarios
 */
import { el } from '../utils.js';
import { codeBlock, openModal } from '../components.js';

export function renderScenarios(state) {
  const wrap = el('div');
  const scenarios = state.scenarios || [];

  wrap.appendChild(el('div', { className: 'section-header' }, `Infrastructure Scenarios (${scenarios.length})`));
  wrap.appendChild(el('p', { className: 'section-desc' },
    'Real-world AI infrastructure misconfigurations discovered by security research. Each scenario reproduces a specific vulnerability you can scan, fix, and verify with HackMyAgent.'));

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
  const tile = el('div', { className: `scenario-tile severity-${scenario.severity}` });

  // Header
  const header = el('div', { className: 'scenario-header' });
  header.appendChild(el('span', { className: 'scenario-name' }, scenario.name));
  if (scenario.checkId) {
    header.appendChild(el('span', { className: 'badge badge-category' }, scenario.checkId));
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
  tile.appendChild(meta);

  // Click to open detail modal
  tile.addEventListener('click', () => {
    const detail = el('div');
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

    openModal(`${scenario.name}: ${scenario.title}`, detail);
  });

  return tile;
}
