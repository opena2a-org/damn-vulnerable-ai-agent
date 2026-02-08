/**
 * Attack Log view
 */

import { el, relativeTime, CATEGORY_LABELS } from '../utils.js';
import { categoryBadge, resultBadge } from '../components.js';
import { resetAll } from '../api.js';

// Filter state (module-level)
let filterAgent = '';
let filterCategory = '';
let filterResult = '';

/**
 * Render the attack log view
 */
export function renderAttackLog(state) {
  const wrap = el('div');
  const log = state.attackLog || [];

  // Controls bar
  const controls = el('div', { className: 'attack-log-controls' });

  // Agent filter
  const agentNames = [...new Set(log.map(e => e.agentName))].sort();
  const agentSelect = el('select', { className: 'filter-select' });
  agentSelect.appendChild(el('option', { value: '' }, 'All agents'));
  for (const name of agentNames) {
    const opt = el('option', { value: name }, name);
    if (filterAgent === name) opt.selected = true;
    agentSelect.appendChild(opt);
  }
  agentSelect.addEventListener('change', (e) => { filterAgent = e.target.value; rerender(); });
  controls.appendChild(agentSelect);

  // Category filter
  const allCats = [...new Set(log.flatMap(e => e.categories))].sort();
  const catSelect = el('select', { className: 'filter-select' });
  catSelect.appendChild(el('option', { value: '' }, 'All categories'));
  for (const cat of allCats) {
    const opt = el('option', { value: cat }, CATEGORY_LABELS[cat] || cat);
    if (filterCategory === cat) opt.selected = true;
    catSelect.appendChild(opt);
  }
  catSelect.addEventListener('change', (e) => { filterCategory = e.target.value; rerender(); });
  controls.appendChild(catSelect);

  // Result filter
  const resultSelect = el('select', { className: 'filter-select' });
  resultSelect.appendChild(el('option', { value: '' }, 'All results'));
  const exploitedOpt = el('option', { value: 'success' }, 'Exploited');
  if (filterResult === 'success') exploitedOpt.selected = true;
  resultSelect.appendChild(exploitedOpt);
  const blockedOpt = el('option', { value: 'blocked' }, 'Blocked');
  if (filterResult === 'blocked') blockedOpt.selected = true;
  resultSelect.appendChild(blockedOpt);
  resultSelect.addEventListener('change', (e) => { filterResult = e.target.value; rerender(); });
  controls.appendChild(resultSelect);

  // Count
  const filtered = applyFilters(log);
  controls.appendChild(el('span', { style: { color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: 'auto' } },
    `${filtered.length} event${filtered.length !== 1 ? 's' : ''}`));

  // Clear button
  const clearBtn = el('button', { className: 'btn btn-danger btn-sm' }, 'Clear All');
  clearBtn.addEventListener('click', async () => {
    await resetAll();
  });
  controls.appendChild(clearBtn);

  wrap.appendChild(controls);

  // Table
  if (filtered.length === 0) {
    const empty = el('div', { className: 'attack-log-empty' });
    empty.appendChild(el('p', { style: { fontSize: '0.9rem', marginBottom: '0.5rem' } }, 'No attack events recorded'));
    empty.appendChild(el('p', { style: { fontSize: '0.8rem' } },
      'Send requests to agents to see attack detection in real-time.'));
    wrap.appendChild(empty);
    return wrap;
  }

  const tableWrap = el('div', { className: 'attack-log-wrap' });
  const table = el('table', { className: 'attack-log-table' });

  // Header
  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', {}, 'Time'));
  headRow.appendChild(el('th', {}, 'Agent'));
  headRow.appendChild(el('th', {}, 'Categories'));
  headRow.appendChild(el('th', {}, 'Result'));
  headRow.appendChild(el('th', {}, 'Input'));
  thead.appendChild(headRow);
  table.appendChild(thead);

  // Body
  const tbody = el('tbody');
  for (const entry of filtered) {
    const row = el('tr');
    row.appendChild(el('td', { style: { whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '0.75rem' } }, relativeTime(entry.timestamp)));
    row.appendChild(el('td', { style: { fontWeight: '500' } }, entry.agentName));

    const catCell = el('td');
    for (const cat of entry.categories) {
      catCell.appendChild(categoryBadge(cat));
      catCell.appendChild(document.createTextNode(' '));
    }
    row.appendChild(catCell);

    row.appendChild(el('td', {}, resultBadge(entry.successful)));
    row.appendChild(el('td', {
      style: { fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--text-muted)', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      title: entry.inputPreview,
    }, entry.inputPreview));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  wrap.appendChild(tableWrap);

  // Stash rerender for filter changes
  function rerender() {
    const app = document.getElementById('app');
    app.replaceChildren(renderAttackLog(state));
  }

  return wrap;
}

function applyFilters(log) {
  return log.filter(entry => {
    if (filterAgent && entry.agentName !== filterAgent) return false;
    if (filterCategory && !entry.categories.includes(filterCategory)) return false;
    if (filterResult === 'success' && !entry.successful) return false;
    if (filterResult === 'blocked' && entry.successful) return false;
    return true;
  });
}
