/**
 * Main app — router, polling, global state
 */

import { fetchHealth, fetchStats, fetchAgents, fetchChallenges, fetchAttackLog } from './api.js';
import { closeModal } from './components.js';
import { renderAgents } from './views/agents.js';
import { renderChallenges } from './views/challenges.js';
import { renderAttackLog } from './views/attack-log.js';
import { renderStats } from './views/stats.js';

// Global state
const state = {
  health: null,
  stats: null,
  agents: [],
  challenges: [],
  attackLog: [],
  currentView: 'agents',
  online: false,
};

// View renderers
const views = {
  agents: renderAgents,
  challenges: renderChallenges,
  'attack-log': renderAttackLog,
  stats: renderStats,
};

/**
 * Route to a view based on hash
 */
function route() {
  const hash = location.hash.slice(1) || 'agents';
  const view = views[hash] ? hash : 'agents';
  state.currentView = view;

  // Update nav active state
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.view === view);
  });

  render();
}

/**
 * Render current view into #app
 */
function render() {
  const app = document.getElementById('app');
  const viewFn = views[state.currentView];
  if (viewFn) {
    const content = viewFn(state);
    app.replaceChildren(content);
  }
}

/**
 * Fetch all data and update state
 */
async function poll() {
  try {
    const [health, stats, agents, challenges, attackLog] = await Promise.all([
      fetchHealth().catch(() => null),
      fetchStats().catch(() => null),
      fetchAgents().catch(() => []),
      fetchChallenges().catch(() => []),
      fetchAttackLog().catch(() => []),
    ]);

    state.health = health;
    state.stats = stats;
    state.agents = agents;
    state.challenges = challenges;
    state.attackLog = attackLog;
    state.online = !!health;

    // Update status indicator
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className = `status-dot ${state.online ? 'online' : 'offline'}`;
    text.textContent = state.online ? `${health.agents} agents` : 'Offline';

    render();
  } catch {
    state.online = false;
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className = 'status-dot offline';
    text.textContent = 'Offline';
  }
}

// Initialize
function init() {
  // Nav click handler
  document.getElementById('nav').addEventListener('click', (e) => {
    const link = e.target.closest('.nav-link');
    if (link && link.dataset.view) {
      // Only handle hash-based SPA navigation
      e.preventDefault();
      location.hash = link.dataset.view;
    }
    // Let browser handle normal links (like /playground.html) naturally
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Hash routing
  window.addEventListener('hashchange', route);
  route();

  // Initial fetch + polling
  poll();
  setInterval(poll, 2000);
}

init();
