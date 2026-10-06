/**
 * Dashboard client logic (#92, #93), run under a minimal DOM shim:
 *   - markdown links only for http:, https: and mailto:;
 *   - api.js errors carry the server's error text, every POST is JSON;
 *   - the Stats sort survives the 2 s refresh;
 *   - "Hardened reference agent" only for hardened agents, DataBot's vulns;
 *   - Attack Log: clearing the log is not a full reset, the full reset asks
 *     first and forgets browser-side progress;
 *   - the Settings privacy panel states what the code actually does.
 *
 * The shim implements just enough of the DOM for el() and the views tested here.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Minimal DOM shim
// ---------------------------------------------------------------------------

class FakeText {
  constructor(text) { this.nodeType = 3; this.data = String(text); }
  get textContent() { return this.data; }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = {};
    this.className = '';
    this.disabled = false;
    this.value = '';
    const classes = () => new Set(String(this.className).split(/\s+/).filter(Boolean));
    const write = (set) => { this.className = [...set].join(' '); };
    this.classList = {
      add: (c) => { const s = classes(); s.add(c); write(s); },
      remove: (c) => { const s = classes(); s.delete(c); write(s); },
      toggle: (c, force) => {
        const s = classes();
        const on = force === undefined ? !s.has(c) : Boolean(force);
        if (on) s.add(c); else s.delete(c);
        write(s);
        return on;
      },
      contains: (c) => classes().has(c),
    };
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  appendChild(child) { this.childNodes.push(child); return child; }
  replaceChildren(...children) { this.childNodes = children; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  async click() {
    const evt = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
    await Promise.all((this.listeners.get('click') || []).map((fn) => fn(evt)));
  }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) { this.childNodes = [new FakeText(v)]; }
  querySelectorAll(tag) { return findAll(this, (n) => n.tagName === String(tag).toUpperCase()); }
}

function findAll(root, predicate) {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes || []) {
      if (child.nodeType !== 1) continue;
      if (predicate(child)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

const textOf = (nodes) => (Array.isArray(nodes) ? nodes : [nodes]).map((n) => n.textContent).join('');
const button = (root, label) => {
  const found = findAll(root, (n) => n.tagName === 'BUTTON' && n.textContent.trim() === label);
  assert.equal(found.length, 1, `expected one "${label}" button, found ${found.length}`);
  return found[0];
};

const appRoot = new FakeElement('div');
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
  getElementById: (id) => (id === 'app' ? appRoot : null),
};

// ---------------------------------------------------------------------------
// Browser globals the views call: fetch, confirm, alert, localStorage
// ---------------------------------------------------------------------------

let calls = [];
let routes = {};
let confirmAnswer = false;
let confirmPrompts = [];
let alerts = [];
const storage = new Map();

globalThis.fetch = async (url, init = {}) => {
  const method = init.method || 'GET';
  calls.push({ url, method, headers: init.headers || {}, body: init.body });
  const route = routes[`${method} ${url}`];
  if (!route) return new Response(JSON.stringify({ error: `no stub for ${method} ${url}` }), { status: 599 });
  const { status = 200, json, text } = route;
  return new Response(text !== undefined ? text : JSON.stringify(json), {
    status,
    headers: { 'Content-Type': text !== undefined ? 'text/plain' : 'application/json' },
  });
};
globalThis.confirm = (message) => { confirmPrompts.push(message); return confirmAnswer; };
globalThis.alert = (message) => { alerts.push(message); };
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => { storage.set(k, String(v)); },
  removeItem: (k) => { storage.delete(k); },
};

beforeEach(() => {
  calls = [];
  routes = {};
  confirmAnswer = false;
  confirmPrompts = [];
  alerts = [];
  storage.clear();
  appRoot.replaceChildren();
});

const { renderMarkdown } = await import('../public/js/markdown.js');
const api = await import('../public/js/api.js');
const { renderStats } = await import('../public/js/views/stats.js');
const { renderAgentDetail } = await import('../public/js/views/agent-detail.js');
const { renderAgents } = await import('../public/js/views/agents.js');
const { renderAttackLog } = await import('../public/js/views/attack-log.js');
const { renderSettings } = await import('../public/js/views/settings.js');
const { CATEGORY_LABELS } = await import('../public/js/utils.js');
const { teachFor } = await import('../public/js/teach.js');
const { AGENTS } = await import('../src/core/agents.js');

// ---------------------------------------------------------------------------
// #92: markdown links
// ---------------------------------------------------------------------------

test('markdown renders links only for http, https and mailto targets', () => {
  const allowed = {
    'https://example.com/docs': 'https://example.com/docs',
    'http://localhost:9000/#agents': 'http://localhost:9000/#agents',
    'mailto:security@example.com': 'mailto:security@example.com',
  };
  for (const [target, href] of Object.entries(allowed)) {
    const nodes = renderMarkdown(`see [the link](${target}) now`);
    const links = nodes.flatMap((n) => findAll(n, (e) => e.tagName === 'A'));
    assert.equal(links.length, 1, `expected a link for ${target}`);
    assert.equal(links[0].getAttribute('href'), href);
    assert.equal(links[0].textContent, 'the link');
    assert.equal(links[0].getAttribute('rel'), 'noopener noreferrer');
  }

  const refused = [
    'javascript:alert(document.domain)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '/relative/path',
    '#agents',
    '//evil.example/x',
  ];
  for (const target of refused) {
    const source = `click [here](${target}) please`;
    const nodes = renderMarkdown(source);
    const links = nodes.flatMap((n) => findAll(n, (e) => e.tagName === 'A'));
    assert.equal(links.length, 0, `no link may be rendered for ${JSON.stringify(target)}`);
    assert.equal(textOf(nodes), source, `the markdown is shown as plain text for ${JSON.stringify(target)}`);
  }
});

test('markdown keeps HTML in model output as text', () => {
  const nodes = renderMarkdown('**bold** <img src=x onerror=alert(1)> [x](https://example.com)<script>alert(1)</script>');
  const tags = new Set(nodes.flatMap((n) => [n, ...findAll(n, () => true)]).filter((n) => n.nodeType === 1).map((n) => n.tagName));
  assert.ok(!tags.has('IMG') && !tags.has('SCRIPT'), `unexpected elements: ${[...tags].join(',')}`);
  assert.match(textOf(nodes), /<img src=x onerror=alert\(1\)>/);
});

// ---------------------------------------------------------------------------
// #93: api.js surfaces the server's error text; #92: every POST is JSON
// ---------------------------------------------------------------------------

test('api.js errors carry the server error text', async () => {
  const hint = 'HMA binary not found. Run `npm install hackmyagent` (or `npm install -g hackmyagent`).';
  routes['POST /api/scenarios/demo/scan'] = { status: 500, json: { error: hint } };
  await assert.rejects(api.scanScenario('demo'), (err) => {
    assert.equal(err.message, hint);
    assert.equal(err.status, 500);
    return true;
  });

  routes['GET /api/scenarios/demo/file?path=missing.txt'] = { status: 404, json: { error: 'File not found' } };
  await assert.rejects(api.readScenarioFile('demo', 'missing.txt'), /File not found/);

  // A body that is not JSON still produces a useful message.
  routes['POST /api/reset'] = { status: 502, text: '<html>Bad gateway</html>' };
  await assert.rejects(api.resetAll(), /POST \/api\/reset: 502/);
});

test('every api.js POST sends a JSON body with a JSON content type', async () => {
  const posts = [
    ['resetAll', () => api.resetAll(), '/api/reset'],
    ['clearAttackLog', () => api.clearAttackLog(), '/api/attack-log/clear'],
    ['disableLLM', () => api.disableLLM(), '/api/llm/disable'],
    ['configureLLM', () => api.configureLLM('openai', 'test-key-not-real', undefined), '/api/llm/configure'],
    ['verifyChallenge', () => api.verifyChallenge('c1', 'answer'), '/api/challenges/c1/verify'],
    ['getTutorGuidance', () => api.getTutorGuidance({ sessionId: 's' }), '/api/tutor/guidance'],
    ['askTutor', () => api.askTutor('s', 'why?'), '/api/tutor/ask'],
    ['scanScenario', () => api.scanScenario('demo'), '/api/scenarios/demo/scan'],
    ['fixScenario', () => api.fixScenario('demo'), '/api/scenarios/demo/fix'],
  ];
  for (const [name, call, url] of posts) {
    routes[`POST ${url}`] = { json: { status: 'ok' } };
    calls = [];
    await call();
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0].url, url, name);
    assert.equal(calls[0].headers['Content-Type'], 'application/json', name);
    assert.doesNotThrow(() => JSON.parse(calls[0].body), `${name} body must be JSON`);
  }
});

// ---------------------------------------------------------------------------
// #93: Stats sort survives the 2 s refresh
// ---------------------------------------------------------------------------

test('the per-agent sort on the Stats view survives a re-render', () => {
  const state = {
    stats: { totalRequests: 9, attacksDetected: 4, attacksSuccessful: 2, byCategory: {} },
    agents: [
      { name: 'Alpha', securityLevel: 'weak', stats: { requests: 9, attacks: 1, successful: 0 } },
      { name: 'Charlie', securityLevel: 'weak', stats: { requests: 1, attacks: 2, successful: 2 } },
      { name: 'Bravo', securityLevel: 'weak', stats: { requests: 5, attacks: 1, successful: 0 } },
    ],
  };
  const rowNames = (view) => findAll(view, (n) => n.tagName === 'TBODY')[0].childNodes.map((tr) => tr.childNodes[0].textContent);
  const sortedHeader = (view) => view.querySelectorAll('th').filter((th) => th.classList.contains('sorted')).map((th) => th.textContent);

  const first = renderStats(state);
  assert.deepEqual(rowNames(first), ['Alpha', 'Bravo', 'Charlie'], 'default: requests, descending');

  const agentHeader = first.querySelectorAll('th').find((th) => th.textContent === 'Agent');
  agentHeader.click();
  agentHeader.click(); // second click flips to ascending
  assert.deepEqual(rowNames(first), ['Alpha', 'Bravo', 'Charlie']);
  first.querySelectorAll('th').find((th) => th.textContent === 'Successful').click();
  assert.deepEqual(rowNames(first), ['Charlie', 'Alpha', 'Bravo']);

  // The poll re-renders the view from scratch every 2 s.
  const refreshed = renderStats(state);
  assert.deepEqual(sortedHeader(refreshed), ['Successful']);
  assert.deepEqual(rowNames(refreshed), ['Charlie', 'Alpha', 'Bravo']);
});

// ---------------------------------------------------------------------------
// #93: DataBot is not shown as hardened
// ---------------------------------------------------------------------------

function asListed(agent) {
  // Mirrors the GET /agents mapping in src/dashboard/server.js.
  return {
    id: agent.id,
    name: agent.name,
    port: agent.port,
    protocol: agent.protocol,
    securityLevel: agent.securityLevel.id,
    description: agent.description,
    version: agent.version,
    tools: agent.tools?.map((t) => (typeof t === 'string' ? t : t.name)) || [],
    features: agent.features || {},
    vulnerabilities: Object.keys(agent.vulnerabilities || {}),
    stats: { requests: 0, attacks: 0, successful: 0 },
  };
}

test('DataBot declares the vulnerability its tools carry', () => {
  const databot = AGENTS.DATABOT;
  assert.equal(databot.securityLevel.id, 'weak');
  const vulnerableTools = databot.tools.filter((t) => t.vulnerable).map((t) => t.name);
  assert.deepEqual(vulnerableTools, ['query_database', 'list_tables']);

  const listed = asListed(databot);
  assert.ok(listed.vulnerabilities.length > 0, 'DataBot must not list 0 vulnerabilities');
  for (const key of listed.vulnerabilities) {
    assert.ok(CATEGORY_LABELS[key], `${key} has a label in the UI`);
    assert.ok(teachFor(key), `${key} has an explainer in the UI`);
  }

  // Every non-hardened agent declares at least one vulnerability.
  for (const agent of Object.values(AGENTS)) {
    if (agent.securityLevel.id === 'hardened') continue;
    assert.ok(Object.keys(agent.vulnerabilities || {}).length > 0, `${agent.id} lists no vulnerabilities`);
  }
});

test('the agent card and detail view only call hardened agents hardened', () => {
  const databot = asListed(AGENTS.DATABOT);
  const securebot = asListed(AGENTS.SECUREBOT);

  const cards = renderAgents({ agents: [databot] });
  assert.match(textOf(cards), /3 tools \| 1 vuln(?!s)/);

  const detail = renderAgentDetail({ agents: [databot], detailAgentId: 'databot', attackLog: [] });
  assert.doesNotMatch(textOf(detail), /Hardened reference agent/);
  assert.match(textOf(detail), /MCP Exploitation/);

  const weakWithoutVulns = { ...databot, id: 'plain', vulnerabilities: [] };
  const plain = renderAgentDetail({ agents: [weakWithoutVulns], detailAgentId: 'plain', attackLog: [] });
  assert.doesNotMatch(textOf(plain), /Hardened reference agent/);

  const hardened = renderAgentDetail({ agents: [securebot], detailAgentId: 'securebot', attackLog: [] });
  assert.match(textOf(hardened), /Hardened reference agent/);
});

// ---------------------------------------------------------------------------
// #93: Attack Log clear is not a full reset; the reset asks first
// ---------------------------------------------------------------------------

function attackLogState() {
  return {
    attackLog: [{ timestamp: Date.now(), agentName: 'HelperBot', categories: ['promptInjection'], successful: true, inputPreview: 'ignore previous' }],
  };
}

test('Clear log clears only the attack log', async () => {
  routes['POST /api/attack-log/clear'] = { json: { status: 'cleared' } };
  storage.set('dvaa-challenge-state', JSON.stringify({ c1: { completedAt: 1 } }));
  const state = attackLogState();
  const view = renderAttackLog(state);

  await button(view, 'Clear log').click();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST /api/attack-log/clear']);
  assert.deepEqual(confirmPrompts, [], 'clearing the log does not need a confirmation');
  assert.equal(state.attackLog.length, 0);
  assert.ok(storage.has('dvaa-challenge-state'), 'clearing the log keeps progress');
});

test('Reset all progress asks first and then forgets browser-side progress', async () => {
  routes['POST /api/reset'] = { json: { status: 'reset' } };
  storage.set('dvaa-challenge-state', JSON.stringify({ c1: { completedAt: 1 } }));
  const view = renderAttackLog(attackLogState());
  const reset = button(view, 'Reset all progress');

  confirmAnswer = false;
  await reset.click();
  assert.equal(confirmPrompts.length, 1);
  assert.deepEqual(calls, [], 'a declined confirmation sends nothing');
  assert.ok(storage.has('dvaa-challenge-state'));

  confirmAnswer = true;
  await reset.click();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST /api/reset']);
  assert.equal(storage.has('dvaa-challenge-state'), false, 'the full reset clears dvaa-challenge-state');
});

test('a failed clear or reset is reported, with the server error text', async () => {
  routes['POST /api/attack-log/clear'] = { status: 403, json: { error: 'Cross-origin request refused' } };
  routes['POST /api/reset'] = { status: 500, json: { error: 'Internal server error' } };
  storage.set('dvaa-challenge-state', '{}');
  const state = attackLogState();
  const view = renderAttackLog(state);

  await button(view, 'Clear log').click();
  confirmAnswer = true;
  await button(view, 'Reset all progress').click();
  assert.equal(alerts.length, 2, `alerts: ${JSON.stringify(alerts)}`);
  assert.match(alerts[0], /Cross-origin request refused/);
  assert.match(alerts[1], /Internal server error/);
  assert.equal(state.attackLog.length, 1, 'a failed clear leaves the view as it was');
  assert.ok(storage.has('dvaa-challenge-state'), 'a failed reset keeps browser-side state');
});

// ---------------------------------------------------------------------------
// #93: the privacy panel matches the code
// ---------------------------------------------------------------------------

test('the Settings privacy panel states the telemetry default and its real opt-outs', async () => {
  routes['GET /api/llm/status'] = { json: { enabled: false } };
  const view = renderSettings({});
  const privacy = findAll(view, (n) => n.className.split(' ').includes('settings-privacy'))[0];
  assert.ok(privacy, 'privacy section rendered');
  const text = privacy.textContent;

  assert.doesNotMatch(text, /No telemetry/i);
  assert.doesNotMatch(text, /offline by default/i);
  assert.doesNotMatch(text, /No network calls/i);
  assert.match(text, /telemetry is on by default/i);
  for (const optOut of ['--offline', 'OPENA2A_TELEMETRY=off', 'dvaa telemetry off']) {
    assert.ok(text.includes(optOut), `names the opt-out ${optOut}`);
  }
  assert.match(text, /memory only/i);
  assert.match(text, /local DVAA server/i);
});

test('Settings uses the JSON API for Disable and shows server errors on Enable', async () => {
  routes['GET /api/llm/status'] = { json: { enabled: false } };
  routes['POST /api/llm/disable'] = { json: { status: 'disabled', enabled: false } };
  routes['POST /api/llm/configure'] = { status: 400, json: { error: 'provider and apiKey are required' } };
  const view = renderSettings({});
  await new Promise((r) => setImmediate(r));

  calls = [];
  await button(view, 'Disable').click();
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['POST /api/llm/disable']);
  assert.equal(calls[0].headers['Content-Type'], 'application/json');

  const keyInput = findAll(view, (n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'password')[0];
  keyInput.value = 'test-key-not-real';
  await button(view, 'Enable LLM Mode').click();
  const status = findAll(view, (n) => n.getAttribute('id') === 'llm-status-text')[0];
  assert.match(status.textContent, /provider and apiKey are required/);
  assert.doesNotMatch(status.textContent, /undefined/);
});

// ---------------------------------------------------------------------------
// #93: the browser does not undo a reset. Runs last: importing app.js starts
// the dashboard (init() and the first poll).
// ---------------------------------------------------------------------------

test('challenge progress is shown as the server reports it, never merged from localStorage', async () => {
  const { getAllChallenges } = await import('../src/challenges/index.js');
  // Same shape as GET /api/challenges; the server has the first one completed.
  const challenges = getAllChallenges().slice(0, 3).map((c, i) => ({
    id: c.id, level: c.level, name: c.name, category: c.category, targetAgent: c.targetAgent,
    difficulty: c.difficulty, points: c.points, description: c.description.trim(), objectives: c.objectives,
    hints: c.hints, manual: c.successCriteria?.manual || false,
    completed: i === 0 ? { attempts: 1, completedAt: 1700000000000 } : null,
    background: null, defendHow: null, hmaChecks: [], killChainStage: null, track: c.track || null,
    prerequisites: [], solution: null,
  }));
  const stale = JSON.stringify({ [challenges[1].id]: { completedAt: 1700000000000, points: 100, attempts: 1 } });
  routes = {
    'GET /health': { json: { status: 'ok', agents: 0, uptime: 1 } },
    'GET /stats': { json: { totalRequests: 0, byAgent: {}, byCategory: {} } },
    'GET /agents': { json: [] },
    'GET /api/challenges': { json: challenges },
    'GET /api/attack-log': { json: [] },
    'GET /api/scenarios': { json: [] },
    'GET /api/llm/status': { json: { enabled: false } },
  };

  const elements = new Map([['app', appRoot]]);
  const saved = { getElementById: document.getElementById, setInterval: globalThis.setInterval };
  let poll = null;
  document.getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement('div'));
    return elements.get(id);
  };
  document.addEventListener = () => {};
  document.querySelectorAll = () => [];
  globalThis.window = { addEventListener() {} };
  globalThis.location = { hash: '#challenges' };
  globalThis.setInterval = (fn) => { poll = fn; return 0; };
  const completed = () => findAll(appRoot, (n) => n.className.split(' ').includes('scoreboard-count'))[0]?.textContent;

  try {
    storage.set('dvaa-challenge-state', stale);
    await import('../public/js/app.js');
    for (let i = 0; i < 50 && !poll; i++) await new Promise((r) => setImmediate(r));
    assert.ok(poll, 'the dashboard started polling');
    assert.equal(storage.has('dvaa-challenge-state'), false, 'the stale browser copy is dropped at startup');
    assert.equal(completed(), `1 / ${challenges.length} completed`);

    // A tab still running an older dashboard writes the copy again.
    storage.set('dvaa-challenge-state', stale);
    await poll();
    assert.equal(completed(), `1 / ${challenges.length} completed`, 'the next poll must not merge it back');
  } finally {
    document.getElementById = saved.getElementById;
    globalThis.setInterval = saved.setInterval;
  }
});
