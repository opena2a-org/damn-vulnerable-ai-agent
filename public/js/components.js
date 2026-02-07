/**
 * Reusable DOM component builders
 */

import { el, SECURITY_LABELS, PROTOCOL_LABELS, CATEGORY_LABELS, DIFFICULTY_LABELS, formatNumber, successRate } from './utils.js';

/**
 * Security level badge
 */
export function securityBadge(level) {
  return el('span', { className: `badge badge-security badge-${level}` }, SECURITY_LABELS[level] || level);
}

/**
 * Protocol badge
 */
export function protocolBadge(protocol) {
  return el('span', { className: 'badge badge-protocol' }, PROTOCOL_LABELS[protocol] || protocol);
}

/**
 * Category badge (pill)
 */
export function categoryBadge(category) {
  return el('span', { className: 'badge badge-category' }, CATEGORY_LABELS[category] || category);
}

/**
 * Difficulty badge
 */
export function difficultyBadge(difficulty) {
  return el('span', { className: `badge badge-difficulty-${difficulty}` }, DIFFICULTY_LABELS[difficulty] || difficulty);
}

/**
 * Result badge (success/blocked)
 */
export function resultBadge(successful) {
  if (successful) {
    return el('span', { className: 'badge badge-result-success' }, 'EXPLOITED');
  }
  return el('span', { className: 'badge badge-result-blocked' }, 'BLOCKED');
}

/**
 * Health dot indicator
 */
export function healthDot(isUp) {
  return el('span', { className: `health-dot ${isUp ? 'up' : 'down'}` });
}

/**
 * Stat card (for summary row)
 */
export function statCard(value, label, color) {
  const card = el('div', { className: 'stat-card' });
  const valEl = el('div', { className: 'stat-card-value' }, formatNumber(value));
  if (color) valEl.style.color = color;
  card.appendChild(valEl);
  card.appendChild(el('div', { className: 'stat-card-label' }, label));
  return card;
}

/**
 * Agent stat mini-block
 */
export function agentStat(value, label) {
  const wrap = el('div', { className: 'agent-stat' });
  wrap.appendChild(el('div', { className: 'agent-stat-value' }, String(value)));
  wrap.appendChild(el('div', { className: 'agent-stat-label' }, label));
  return wrap;
}

/**
 * Code block
 */
export function codeBlock(text) {
  const pre = el('pre', { className: 'code-block' });
  pre.textContent = text;
  return pre;
}

/**
 * Challenge completion icon — checkmark or dash
 */
export function challengeStatusIcon(completed) {
  if (completed && completed.completedAt) {
    const icon = el('span', { className: 'challenge-status-icon done' });
    icon.textContent = '[done]';
    return icon;
  }
  const icon = el('span', { className: 'challenge-status-icon pending' });
  icon.textContent = '[ -- ]';
  return icon;
}

/**
 * Open modal
 */
export function openModal(title, bodyEl) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const bodyContainer = document.getElementById('modal-body');
  titleEl.textContent = title;
  bodyContainer.replaceChildren(bodyEl);
  overlay.classList.add('visible');
}

/**
 * Close modal
 */
export function closeModal() {
  document.getElementById('modal-overlay').classList.remove('visible');
}
