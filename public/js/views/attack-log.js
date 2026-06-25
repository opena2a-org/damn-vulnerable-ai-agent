/**
 * Attack Log view
 */

import { el, relativeTime, CATEGORY_LABELS } from '../utils.js';
import { categoryBadge, resultBadge, codeBlock, openModal } from '../components.js';
import { resetAll } from '../api.js';
import { teachFor, findLeaks } from '../teach.js';

// Filter state (module-level)
let filterAgent = '';
let filterCategory = '';
let filterResult = '';

/**
 * Classify a log entry's input so we can rebuild a comparable payload to run
 * against the hardened agent.
 */
function inputKind(entry) {
  const p = entry.inputPreview || '';
  if (p.startsWith('A2A from=')) return 'a2a';
  if (/^\w+\(/.test(p)) return 'mcp';
  return 'api';
}

/**
 * Build the "same payload vs SecureBot" comparison command for an API attack.
 * SecureBot (port 7001) is the hardened reference agent and blocks the payload.
 */
function defendedComparison(entry) {
  if (inputKind(entry) !== 'api') return null;
  const body = JSON.stringify({ messages: [{ role: 'user', content: entry.input || entry.inputPreview }] });
  return `# Same payload against SecureBot (hardened) — blocked, not leaked\n` +
    `curl -X POST http://localhost:7001/v1/chat/completions \\\n` +
    `  -H "Content-Type: application/json" \\\n` +
    `  -d '${body.replace(/'/g, `'\\''`)}'`;
}

/**
 * Render a response block, highlighting any leaked secret it contains.
 */
function responseBlock(text) {
  const leaks = findLeaks(text);
  const pre = el('pre', { className: 'attack-detail-response' });

  if (leaks.length === 0) {
    pre.textContent = text;
    return { pre, leaks };
  }

  // Split on leak markers and wrap each match in a highlight span.
  let rest = text;
  const escaped = leaks.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`);
  while (rest.length) {
    const m = rest.match(re);
    if (!m) { pre.appendChild(document.createTextNode(rest)); break; }
    if (m.index > 0) pre.appendChild(document.createTextNode(rest.slice(0, m.index)));
    pre.appendChild(el('span', { className: 'leak-highlight' }, m[0]));
    rest = rest.slice(m.index + m[0].length);
  }
  return { pre, leaks };
}

/**
 * Build the attack detail drawer body for a single log entry.
 * Exported so the agent detail view can reuse the same drawer.
 */
export function attackDetailModal(entry) {
  const body = el('div', { className: 'attack-detail' });

  // Meta row
  const meta = el('div', { className: 'attack-detail-meta' });
  meta.appendChild(resultBadge(entry.successful));
  meta.appendChild(el('span', { className: 'attack-detail-agent' }, `${entry.agentName} :${entry.port}`));
  meta.appendChild(el('span', { className: 'attack-detail-time' }, relativeTime(entry.timestamp)));
  body.appendChild(meta);

  // Categories
  const catWrap = el('div', { className: 'attack-detail-cats' });
  for (const cat of entry.categories) {
    catWrap.appendChild(categoryBadge(cat));
  }
  body.appendChild(catWrap);

  // Input
  body.appendChild(el('div', { className: 'attack-detail-label' }, 'Payload sent'));
  body.appendChild(codeBlock(entry.input || entry.inputPreview || '(none recorded)'));

  // Response / outcome
  body.appendChild(el('div', { className: 'attack-detail-label' }, 'Agent response'));
  if (entry.response) {
    const { pre, leaks } = responseBlock(entry.response);
    body.appendChild(pre);
    if (leaks.length) {
      const warn = el('div', { className: 'attack-detail-leak-callout' });
      warn.appendChild(el('strong', {}, `Secrets leaked (${leaks.length}): `));
      warn.appendChild(document.createTextNode(leaks.join(', ')));
      body.appendChild(warn);
    }
  } else {
    body.appendChild(el('p', { className: 'attack-detail-empty' },
      entry.successful ? 'No response recorded for this event.' : 'Blocked — no sensitive data returned.'));
  }

  // Teach: what each category is, why it matters, how to defend
  body.appendChild(el('div', { className: 'attack-detail-label' }, 'What happened & how to defend'));
  let taught = false;
  const seen = new Set();
  for (const cat of entry.categories) {
    const t = teachFor(cat);
    if (!t || seen.has(cat)) continue;
    seen.add(cat);
    taught = true;
    const card = el('div', { className: 'teach-card' });
    const head = el('div', { className: 'teach-card-head' });
    head.appendChild(el('span', { className: 'teach-card-title' }, CATEGORY_LABELS[cat] || cat));
    head.appendChild(el('span', { className: 'teach-oasb' }, `OASB ${t.oasb}`));
    card.appendChild(head);
    card.appendChild(teachRow('What', t.what));
    card.appendChild(teachRow('Why it matters', t.why));
    card.appendChild(teachRow('Defend', t.defend));
    body.appendChild(card);
  }
  if (!taught) {
    body.appendChild(el('p', { className: 'attack-detail-empty' }, 'No explainer available for this category.'));
  }

  // Compare against the hardened agent
  const cmp = defendedComparison(entry);
  if (cmp) {
    body.appendChild(el('div', { className: 'attack-detail-label' }, 'Verify the defense'));
    body.appendChild(el('p', { className: 'attack-detail-hint' },
      'Run the identical payload against SecureBot, the hardened reference agent. It blocks instead of leaking.'));
    body.appendChild(codeBlock(cmp));
  }

  return body;
}

function teachRow(label, text) {
  const row = el('div', { className: 'teach-row' });
  row.appendChild(el('span', { className: 'teach-row-label' }, label));
  row.appendChild(el('span', { className: 'teach-row-text' }, text));
  return row;
}

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
  headRow.appendChild(el('th', {}, ''));
  thead.appendChild(headRow);
  table.appendChild(thead);

  // Body
  const tbody = el('tbody');
  for (const entry of filtered) {
    const row = el('tr', { className: 'attack-row', title: 'Click for full payload, response, and how to defend' });
    row.addEventListener('click', () => openModal(`Attack detail — ${entry.agentName}`, attackDetailModal(entry)));

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

    // Outcome affordance: flag leaks, otherwise a "view" chevron
    const leaks = entry.response ? findLeaks(entry.response) : [];
    const outcomeCell = el('td', { style: { whiteSpace: 'nowrap', textAlign: 'right' } });
    if (leaks.length) {
      outcomeCell.appendChild(el('span', { className: 'leak-flag', title: `Leaked: ${leaks.join(', ')}` }, `leaked ${leaks.length}`));
    } else {
      outcomeCell.appendChild(el('span', { className: 'attack-row-view' }, 'view ›'));
    }
    row.appendChild(outcomeCell);

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
