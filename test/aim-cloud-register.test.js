/**
 * Unit tests for the aim-sdk-login -> DVAA cloud-register bridge.
 *
 * Verifies credential parsing, API-base resolution, and the register/load
 * contract (GET then POST /api/v1/agents with a Bearer JWT) against a local
 * mock backend — no live AIM cloud needed.
 */

import test from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const { readLoginCredentials, resolveApiBase, registerOrLoadAgent } =
  await import('../src/aim-cloud-register.js');

test('readLoginCredentials parses the aim-sdk login file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-cred-'));
  const f = path.join(dir, 'creds.json');
  fs.writeFileSync(f, JSON.stringify({ accessToken: 'jwt-123', aimUrl: 'https://aim.opena2a.org/', userEmail: 'a@b.c' }));
  const c = readLoginCredentials(f);
  assert.equal(c.accessToken, 'jwt-123');
  assert.equal(c.aimUrl, 'https://aim.opena2a.org'); // trailing slash stripped
  assert.equal(c.userEmail, 'a@b.c');
  assert.equal(readLoginCredentials(path.join(dir, 'missing.json')), null);
});

test('resolveApiBase maps frontend host -> api backend host', () => {
  delete process.env.AIM_SERVER_URL;
  assert.equal(resolveApiBase('https://aim.opena2a.org'), 'https://api.aim.opena2a.org');
  assert.equal(resolveApiBase('https://api.aim.opena2a.org'), 'https://api.aim.opena2a.org');
  assert.equal(resolveApiBase('http://localhost:3000'), 'http://localhost:8080');
  process.env.AIM_SERVER_URL = 'http://127.0.0.1:9999';
  assert.equal(resolveApiBase('https://aim.opena2a.org'), 'http://127.0.0.1:9999'); // env override
  delete process.env.AIM_SERVER_URL;
});

test('registerOrLoadAgent registers a new agent, then loads from cache', async () => {
  const received = [];
  const srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/v1/agents' && req.method === 'GET') return res.end('[]');
      if (req.url === '/api/v1/agents' && req.method === 'POST') { res.statusCode = 201; return res.end(JSON.stringify({ id: 'uuid-xyz' })); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const apiBase = `http://127.0.0.1:${srv.address().port}`;
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-cache-'));
  const cacheFile = path.join(cacheDir, 'cloud-agent.json');

  const first = await registerOrLoadAgent({ apiBase, jwt: 'jwt-abc', publicKey: 'PUBKEY==', cacheFile });
  assert.equal(first.agentId, 'uuid-xyz');
  assert.equal(first.registered, true);
  // GET then POST, both with the Bearer JWT; POST body carries the contract.
  assert.equal(received[0].method, 'GET');
  assert.equal(received[1].method, 'POST');
  assert.equal(received[1].auth, 'Bearer jwt-abc');
  assert.equal(received[1].body.name, 'dvaa-ragbot-aim');
  assert.equal(received[1].body.publicKey, 'PUBKEY==');
  assert.deepEqual(received[1].body.capabilities, ['rag:read', 'chat:respond']);

  // Second call hits the cache — no new HTTP requests.
  const before = received.length;
  const second = await registerOrLoadAgent({ apiBase, jwt: 'jwt-abc', publicKey: 'PUBKEY==', cacheFile });
  assert.equal(second.agentId, 'uuid-xyz');
  assert.equal(second.cached, true);
  assert.equal(received.length, before, 'cache hit issues no network call');

  srv.close();
});

test('registerOrLoadAgent surfaces a 401 as an actionable error', async () => {
  const srv = http.createServer((req, res) => { res.statusCode = 401; res.end('{"error":"expired"}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const apiBase = `http://127.0.0.1:${srv.address().port}`;
  const res = await registerOrLoadAgent({ apiBase, jwt: 'bad', publicKey: 'k' });
  assert.equal(res.error, 'unauthorized');
  assert.match(res.detail, /aim-sdk login/);
  srv.close();
});
