/**
 * Stats Overview view
 */

import { el, CATEGORY_LABELS, formatNumber, successRate, formatUptime } from '../utils.js';
import { statCard } from '../components.js';

/**
 * Render the stats overview
 */
export function renderStats(state) {
  const wrap = el('div');
  const stats = state.stats || {};
  const agents = state.agents || [];

  // Summary cards
  const cards = el('div', { className: 'stat-cards' });
  cards.appendChild(statCard(stats.totalRequests || 0, 'Total Requests', 'var(--text)'));
  cards.appendChild(statCard(stats.attacksDetected || 0, 'Attacks Detected', 'var(--amber)'));
  cards.appendChild(statCard(stats.attacksSuccessful || 0, 'Attacks Successful', 'var(--red)'));

  const rate = successRate(stats.attacksDetected, stats.attacksSuccessful);
  const rateColor = rate > 50 ? 'var(--red)' : rate > 25 ? 'var(--orange)' : 'var(--green)';
  cards.appendChild(statCard(`${rate}%`, 'Success Rate', rateColor));

  if (stats.startedAt) {
    const uptime = Math.floor((Date.now() - stats.startedAt) / 1000);
    cards.appendChild(statCard(formatUptime(uptime), 'Uptime', 'var(--teal)'));
  }
  wrap.appendChild(cards);

  // Per-category bar chart
  const byCategory = stats.byCategory || {};
  const categories = Object.entries(byCategory);
  if (categories.length > 0) {
    wrap.appendChild(el('div', { className: 'section-header' }, 'Attacks by Category'));

    const maxDetected = Math.max(1, ...categories.map(([, v]) => v.detected));
    const chart = el('div', { className: 'category-chart' });

    // Sort by volume (detected descending)
    const sorted = [...categories].sort((a, b) => b[1].detected - a[1].detected);

    for (const [cat, data] of sorted) {
      const row = el('div', { className: 'category-bar-row' });
      row.appendChild(el('div', { className: 'category-bar-label' }, CATEGORY_LABELS[cat] || cat));

      const track = el('div', { className: 'category-bar-track' });
      const blockedWidth = data.detected > 0 ? ((data.detected - data.successful) / maxDetected) * 100 : 0;
      const successWidth = data.detected > 0 ? (data.successful / maxDetected) * 100 : 0;
      const blockedBar = el('div', { className: 'category-bar-detected' });
      blockedBar.style.width = `${blockedWidth}%`;
      const successBar = el('div', { className: 'category-bar-successful' });
      successBar.style.width = `${successWidth}%`;
      track.appendChild(successBar);
      track.appendChild(blockedBar);
      row.appendChild(track);

      row.appendChild(el('div', { className: 'category-bar-count' }, `${data.successful}/${data.detected}`));
      chart.appendChild(row);
    }

    // Legend
    const legend = el('div', { style: { display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' } });
    const legendSuccessful = el('span', { style: { display: 'flex', alignItems: 'center', gap: '0.25rem' } });
    legendSuccessful.appendChild(el('span', { style: { width: '12px', height: '12px', background: 'var(--red)', borderRadius: '2px', display: 'inline-block' } }));
    legendSuccessful.appendChild(document.createTextNode('Successful'));
    legend.appendChild(legendSuccessful);

    const legendBlocked = el('span', { style: { display: 'flex', alignItems: 'center', gap: '0.25rem' } });
    legendBlocked.appendChild(el('span', { style: { width: '12px', height: '12px', background: 'var(--amber)', borderRadius: '2px', display: 'inline-block' } }));
    legendBlocked.appendChild(document.createTextNode('Blocked'));
    legend.appendChild(legendBlocked);
    chart.appendChild(legend);

    wrap.appendChild(chart);
  }

  // Per-agent table
  if (agents.length > 0) {
    wrap.appendChild(el('div', { className: 'section-header' }, 'Per-Agent Breakdown'));

    const table = el('table', { className: 'data-table' });
    const thead = el('thead');
    const headRow = el('tr');
    const columns = ['Agent', 'Requests', 'Attacks', 'Successful', 'Rate'];
    const sortKeys = ['name', 'requests', 'attacks', 'successful', 'rate'];
    let sortCol = 'requests';
    let sortAsc = false;

    for (let i = 0; i < columns.length; i++) {
      const th = el('th', {}, columns[i]);
      if (sortKeys[i] === sortCol) th.classList.add('sorted');
      th.addEventListener('click', () => {
        if (sortCol === sortKeys[i]) sortAsc = !sortAsc;
        else { sortCol = sortKeys[i]; sortAsc = false; }
        rerenderTable();
      });
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = el('tbody');

    function buildRows() {
      const rows = agents.map(a => {
        const s = a.stats || { requests: 0, attacks: 0, successful: 0 };
        return {
          name: a.name,
          requests: s.requests,
          attacks: s.attacks,
          successful: s.successful,
          rate: s.attacks > 0 ? (s.successful / s.attacks) * 100 : 0,
          securityLevel: a.securityLevel,
        };
      });

      rows.sort((a, b) => {
        const valA = a[sortCol];
        const valB = b[sortCol];
        if (typeof valA === 'string') return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return sortAsc ? valA - valB : valB - valA;
      });

      return rows;
    }

    function renderRows() {
      tbody.replaceChildren();
      for (const row of buildRows()) {
        const tr = el('tr');
        tr.appendChild(el('td', {}, row.name));
        tr.appendChild(el('td', { className: 'mono' }, formatNumber(row.requests)));
        tr.appendChild(el('td', { className: 'mono' }, formatNumber(row.attacks)));
        tr.appendChild(el('td', { className: 'mono' }, formatNumber(row.successful)));
        const rateTd = el('td', { className: 'mono' });
        rateTd.textContent = `${row.rate.toFixed(1)}%`;
        rateTd.style.color = row.rate > 50 ? 'var(--red)' : row.rate > 25 ? 'var(--orange)' : 'var(--text-muted)';
        tr.appendChild(rateTd);
        tbody.appendChild(tr);
      }
    }

    renderRows();
    table.appendChild(tbody);
    wrap.appendChild(table);

    function rerenderTable() {
      headRow.querySelectorAll('th').forEach((th, i) => {
        th.classList.toggle('sorted', sortKeys[i] === sortCol);
      });
      renderRows();
    }
  }

  return wrap;
}
