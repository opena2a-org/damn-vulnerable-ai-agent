/**
 * Main app — router, polling, global state
 */

import { fetchHealth, fetchStats, fetchAgents, fetchChallenges, fetchAttackLog, fetchScenarios } from './api.js';
import { closeModal } from './components.js';
import { renderAgents } from './views/agents.js';
import { renderChallenges } from './views/challenges.js';
import { renderAttackLog } from './views/attack-log.js';
import { renderStats } from './views/stats.js';
import { renderAttackLab } from './views/attack-lab.js';
import { renderSettings } from './views/settings.js';
import { renderScenarios } from './views/scenarios.js';

// localStorage persistence for challenge progress
const STORAGE_KEY = 'dvaa-challenge-state';

function saveProgress(challenges) {
  const saved = {};
  challenges.forEach(c => {
    if (c.completed?.completedAt) {
      saved[c.id] = { completedAt: c.completed.completedAt, points: c.points, attempts: c.completed.attempts };
    }
  });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); } catch {}
}

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function mergeProgress(challenges) {
  const saved = loadProgress();
  for (const c of challenges) {
    if (!c.completed?.completedAt && saved[c.id]?.completedAt) {
      c.completed = saved[c.id];
    }
  }
  return challenges;
}

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
  'attack-lab': renderAttackLab,
  scenarios: renderScenarios,
  settings: renderSettings,
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

// Views that own their own interactive state (textarea content, dropdown selection,
// in-flight chat). Auto-poll must not re-render these — it would clobber user input.
// They re-render only on explicit navigation (hashchange).
const INTERACTIVE_VIEWS = new Set(['attack-lab', 'settings']);

/**
 * Render current view into #app.
 * @param {object} opts
 * @param {boolean} opts.fromPoll - If true, skip re-render for interactive views.
 */
function render(opts = {}) {
  if (opts.fromPoll && INTERACTIVE_VIEWS.has(state.currentView)) return;
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
    state.challenges = mergeProgress(challenges);
    state.attackLog = attackLog;
    state.online = !!health;

    // Persist challenge progress to localStorage
    saveProgress(state.challenges);

    // Scenarios (includes completion status from server)
    state.scenarios = await fetchScenarios().catch(() => []);

    // LLM status
    const llmStatus = await fetch('/api/llm/status').then(r => r.json()).catch(() => ({ enabled: false }));
    state.llmEnabled = llmStatus.enabled;
    state.llmProvider = llmStatus.provider;
    state.llmModel = llmStatus.model;

    // Update status indicator
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className = `status-dot ${state.online ? 'online' : 'offline'}`;
    text.textContent = state.online ? `${health.agents} agents` : 'Offline';

    render({ fromPoll: true });
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

  // Fetch initial data BEFORE first render so views (especially attack-lab)
  // see populated state.agents on mount. Then start polling.
  poll().finally(() => {
    route();
    setInterval(poll, 2000);
  });
}

init();
