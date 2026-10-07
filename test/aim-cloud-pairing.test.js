/**
 * AIM cloud reporting pairs each agent with ITS OWN registration (#98).
 *
 * Every AIM-enforced agent signs with its own Ed25519 key. These tests run
 * against a local mock AIM backend (127.0.0.1, port 0) that answers like the
 * real one: a report whose publicKey differs from the registration's key gets
 * 401 "Public key mismatch". No real AIM server is contacted.
 */

import { test, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloudAgentIdFor, cloudAgentIdVar, cloudReporterEnabled } from '../src/aim-cloud-reporter.js';
import { registerOrLoadAgent } from '../src/aim-cloud-register.js';
import { postFailureHint } from '../src/cli/commands/demo.js';
import { getAllAgents } from '../src/core/agents.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const agent = (id) => getAllAgents().find(a => a.id === id);

test('each agent reports under its own registration id, never another agent\'s', () => {
  const env = { DVAA_AIM_CLOUD_AGENT_ID: 'rag-uuid', DVAA_AIM_CLOUD_AGENT_ID_FLIGHTBOT_AIM: 'flight-uuid' };
  assert.equal(cloudAgentIdVar('flightbot-aim'), 'DVAA_AIM_CLOUD_AGENT_ID_FLIGHTBOT_AIM');
  // The single id the setup script prints belongs to the agent it registers.
  assert.equal(cloudAgentIdFor('ragbot-aim', env), 'rag-uuid');
  assert.equal(cloudAgentIdFor('flightbot-aim', env), 'flight-uuid');
  assert.equal(cloudAgentIdFor('researchbot-aim', env), null);
  assert.equal(cloudAgentIdFor('repobot-aim', env), null);
  assert.equal(cloudReporterEnabled({ AIM_SERVER_URL: 'http://x', AIM_API_KEY: 'k', DVAA_AIM_CLOUD_AGENT_ID_REPOBOT_AIM: 'r' }), true);
  assert.equal(cloudReporterEnabled({ AIM_SERVER_URL: 'http://x', AIM_API_KEY: 'k' }), false);
});

// A mock AIM backend: verification posts are checked against registered keys.
// `registrations` maps cloud agent id -> public key; null = trust the first key seen.
async function mockAim(registrations) {
  const posts = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const json = body ? JSON.parse(body) : {};
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/api/v1/sdk-api/verifications') {
        posts.push(json);
        if (!(json.agentId in registrations)) { res.statusCode = 404; return res.end('{"error":"Agent not found"}'); }
        registrations[json.agentId] ??= json.publicKey;
        if (registrations[json.agentId] !== json.publicKey) { res.statusCode = 401; return res.end('{"error":"Public key mismatch"}'); }
        return res.end('{"id":"v1","status":"approved"}');
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, posts, close: () => srv.close() };
}

// Run maybeEnforce from a fresh module instance (the enforcer keeps
// per-process state) with cloud env set, capturing what it prints.
async function withEnforcer(env, fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-aim-pairing-'));
  const keys = ['AIM_SERVER_URL', 'AIM_API_KEY', 'DVAA_AIM_CLOUD_AGENT_ID', 'DVAA_AIM_DATA_DIR', 'AIM_ENFORCEMENT', 'DVAA_AIM_CLOUD_DEBUG',
    ...['ragbot-aim', 'researchbot-aim', 'flightbot-aim', 'repobot-aim'].map(cloudAgentIdVar)];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { DVAA_AIM_DATA_DIR: dataDir, ...env });
  const stderr = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk, ...rest) => { stderr.push(String(chunk)); return true; };
  try {
    const { maybeEnforce } = await import(`../src/aim-enforcer.js?case=${Math.random()}`);
    await fn(maybeEnforce, stderr);
  } finally {
    process.stderr.write = write;
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

const decide = (maybeEnforce, id) => maybeEnforce(agent(id), { action: 'http:post', resource: 'http://127.0.0.1:1/x', context: { tool: 'test' } });

test('with the setup script\'s single id, only RAGBot-AIM posts; the others say so once', async () => {
  const aim = await mockAim({ 'rag-uuid': null });
  try {
    await withEnforcer({ AIM_SERVER_URL: aim.url, AIM_API_KEY: 'not_required', DVAA_AIM_CLOUD_AGENT_ID: 'rag-uuid' }, async (maybeEnforce, stderr) => {
      for (const id of ['ragbot-aim', 'flightbot-aim', 'researchbot-aim', 'flightbot-aim', 'ragbot-aim']) await decide(maybeEnforce, id);
      await sleep(300);
      assert.equal(aim.posts.length, 2, `only RAGBot-AIM's two decisions are posted: ${JSON.stringify(aim.posts.map(p => p.agentId))}`);
      assert.ok(aim.posts.every(p => p.agentId === 'rag-uuid' && p.publicKey === aim.posts[0].publicKey));
      const notices = stderr.join('');
      assert.equal((notices.match(/flightbot-aim: not reporting/g) || []).length, 1, `one notice per agent: ${notices}`);
      assert.equal((notices.match(/researchbot-aim: not reporting/g) || []).length, 1, notices);
      assert.match(notices, /DVAA_AIM_CLOUD_AGENT_ID_FLIGHTBOT_AIM=/, 'the notice names the variable that fixes it');
      assert.doesNotMatch(notices, /ragbot-aim: not reporting/, notices);
    });
  } finally {
    aim.close();
  }
});

test('a registration that holds another key is skipped after one 401, with a notice (no debug flag)', async () => {
  const aim = await mockAim({ 'flight-uuid': 'SOME-OTHER-KEY' });
  try {
    await withEnforcer({ AIM_SERVER_URL: aim.url, AIM_API_KEY: 'k', DVAA_AIM_CLOUD_AGENT_ID_FLIGHTBOT_AIM: 'flight-uuid' }, async (maybeEnforce, stderr) => {
      await decide(maybeEnforce, 'flightbot-aim');
      await sleep(300);
      await decide(maybeEnforce, 'flightbot-aim');
      await decide(maybeEnforce, 'flightbot-aim');
      await sleep(300);
      assert.equal(aim.posts.length, 1, 'no further doomed posts after the mismatch');
      const notices = stderr.join('');
      assert.equal((notices.match(/flightbot-aim: AIM rejected its report/g) || []).length, 1, notices);
      assert.match(notices, /HTTP 401: Public key mismatch/, notices);
    });
  } finally {
    aim.close();
  }
});

// ---- `dvaa demo aim-ab --cloud` registration -------------------------------

// A mock of the agent-management routes the registration uses.
async function mockRegistry({ existing, putStatus = 200 }) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'GET' && req.url === '/api/v1/agents') return res.end(JSON.stringify({ agents: existing ? [existing] : [] }));
      if (req.method === 'PUT' && existing && req.url === `/api/v1/agents/${existing.id}/keys`) {
        res.statusCode = putStatus;
        if (putStatus !== 200) return res.end('{"error":"key update refused"}');
        existing.publicKey = JSON.parse(body).publicKey;
        return res.end(JSON.stringify({ success: true, publicKey: existing.publicKey }));
      }
      if (req.method === 'POST' && req.url === '/api/v1/agents') { res.statusCode = 201; return res.end('{"id":"new-uuid"}'); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { apiBase: `http://127.0.0.1:${srv.address().port}`, calls, close: () => srv.close() };
}

// Each cache file gets its own temporary directory, removed once the tests finish.
const cacheDirs = [];
after(() => {
  for (const dir of cacheDirs) fs.rmSync(dir, { recursive: true, force: true });
});
const tmpCache = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvaa-aim-cache-'));
  cacheDirs.push(dir);
  return path.join(dir, 'cloud-agent.json');
};

test('an existing registration with the same key is reused and cached', async () => {
  const reg = await mockRegistry({ existing: { id: 'agent-1', name: 'dvaa-ragbot-aim', publicKey: 'LOCAL==' } });
  try {
    const cacheFile = tmpCache();
    const res = await registerOrLoadAgent({ apiBase: reg.apiBase, jwt: 'jwt', publicKey: 'LOCAL==', cacheFile });
    assert.deepEqual(res, { agentId: 'agent-1', existing: true });
    assert.equal(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')).confirmed, true);
  } finally {
    reg.close();
  }
});

test('a same-name registration with a different key is moved to this install\'s key before it is cached', async () => {
  const reg = await mockRegistry({ existing: { id: 'agent-1', name: 'dvaa-ragbot-aim', publicKey: 'OLD==' } });
  try {
    const cacheFile = tmpCache();
    const res = await registerOrLoadAgent({ apiBase: reg.apiBase, jwt: 'jwt', publicKey: 'NEW==', cacheFile });
    assert.equal(res.agentId, 'agent-1');
    assert.equal(res.keyUpdated, true);
    const put = reg.calls.find(c => c.method === 'PUT');
    assert.deepEqual(put, { method: 'PUT', url: '/api/v1/agents/agent-1/keys', body: { publicKey: 'NEW==' } });
    assert.deepEqual(JSON.parse(fs.readFileSync(cacheFile, 'utf-8')), { agentId: 'agent-1', publicKey: 'NEW==', apiBase: reg.apiBase, confirmed: true });
  } finally {
    reg.close();
  }
});

test('a key mismatch the server will not fix is an error, and nothing is cached', async () => {
  const reg = await mockRegistry({ existing: { id: 'agent-1', name: 'dvaa-ragbot-aim', publicKey: 'OLD==' }, putStatus: 500 });
  try {
    const cacheFile = tmpCache();
    const res = await registerOrLoadAgent({ apiBase: reg.apiBase, jwt: 'jwt', publicKey: 'NEW==', cacheFile });
    assert.equal(res.error, 'key_mismatch');
    assert.match(res.detail, /different public key/);
    assert.equal(fs.existsSync(cacheFile), false, 'an unconfirmed pairing must not be cached');
  } finally {
    reg.close();
  }
});

test('a cache entry written before pairings were confirmed is re-checked with the server', async () => {
  const reg = await mockRegistry({ existing: { id: 'agent-1', name: 'dvaa-ragbot-aim', publicKey: 'OLD==' } });
  try {
    const cacheFile = tmpCache();
    fs.writeFileSync(cacheFile, JSON.stringify({ agentId: 'agent-1', publicKey: 'NEW==', apiBase: reg.apiBase }));
    const res = await registerOrLoadAgent({ apiBase: reg.apiBase, jwt: 'jwt', publicKey: 'NEW==', cacheFile });
    assert.equal(res.cached, undefined, 'the legacy entry is not trusted');
    assert.equal(res.keyUpdated, true);
  } finally {
    reg.close();
  }
});

test('a 401 on the event post points at the key, not at aim-sdk login, and clears the cache', () => {
  const forgotten = [];
  const ctx = { agentId: 'agent-1', publicKey: 'ABCDEFGHIJKLMNOP==', cacheFile: '/tmp/x/cloud-agent.json', apiBase: 'http://127.0.0.1:1', dashboardUrl: 'http://127.0.0.1:2/agents/agent-1' };
  const lines = postFailureHint({ ok: false, status: 401, error: 'http_401', body: { error: 'Public key mismatch' } }, ctx, (f) => forgotten.push(f));
  const text = lines.join('\n');
  assert.doesNotMatch(text, /aim-sdk login/);
  assert.match(text, /Public key mismatch/);
  assert.match(text, /re-run\s+dvaa demo aim-ab --cloud/);
  assert.deepEqual(forgotten, ['/tmp/x/cloud-agent.json']);
  const other = postFailureHint({ ok: false, error: 'timeout' }, ctx, () => assert.fail('only a 401 clears the cache')).join('\n');
  assert.doesNotMatch(other, /aim-sdk login/);
});
