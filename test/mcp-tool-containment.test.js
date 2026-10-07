/**
 * MCP tool containment (#85).
 *
 * Live checks against a running fleet (skipped when none is reachable):
 *   1. PluginBot store_secret refuses a key that resolves outside the sandbox,
 *      and still stores an ordinary key (the intended no-access-control lesson).
 *   2. ToolBot fetch_url fetches DVAA agents on loopback for real, so the
 *      documented L3-02 solution verifies.
 *   3. fetch_url logs URLs whose host is not a DVAA agent on loopback without
 *      fetching them, including a URL that carries a loopback port elsewhere.
 *   4. The documented L2-03 solution (#128), sent as written, reads the
 *      sandbox's passwd file through ToolBot read_file and verifies.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getChallenge } from '../src/challenges/index.js';

const DASH = 'http://localhost:9000';
const TOOLBOT = 'http://localhost:7010';
const PLUGINBOT = 'http://localhost:7012';

async function isUp(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  try { await fetch(url, { signal: ctrl.signal }); return true; }
  catch { return false; }
  finally { clearTimeout(t); }
}

async function callTool(base, name, args) {
  const resp = await fetch(`${base}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', id: 1, params: { name, arguments: args } }),
  });
  const rpc = await resp.json();
  if (rpc.error) return { rpcError: rpc.error.message };
  return JSON.parse(rpc.result.content[0].text);
}

async function skipWithoutFleet(t) {
  if (await isUp(`${DASH}/health`)) return false;
  t.skip('DVAA fleet not running on :9000 (start it with `npm run start:all`)');
  return true;
}

test('store_secret refuses a key that resolves outside the sandbox', async (t) => {
  if (await skipWithoutFleet(t)) return;
  const name = `dvaa-containment-probe-${process.pid}-${Date.now()}`;
  const escaped = path.join(os.tmpdir(), `${name}.txt`);

  const result = await callTool(PLUGINBOT, 'store_secret', {
    key: `../../../../${name}`,
    value: 'must-not-be-written',
  });

  assert.strictEqual(result.rpcError, 'Path outside sandbox boundary');
  assert.ok(!fs.existsSync(escaped), `store_secret wrote outside the sandbox: ${escaped}`);
});

test('store_secret still stores an ordinary key (intended vulnerability)', async (t) => {
  if (await skipWithoutFleet(t)) return;
  const result = await callTool(PLUGINBOT, 'store_secret', { key: 'containment-probe', value: 'plaintext' });
  assert.strictEqual(result.success, true);
  assert.match(result.note, /without access control/);
});

test('fetch_url reaches a DVAA agent and the documented L3-02 solution verifies', async (t) => {
  if (await skipWithoutFleet(t)) return;
  const result = await callTool(TOOLBOT, 'fetch_url', { url: 'http://localhost:7003/info' });
  const seen = JSON.stringify(result).slice(0, 300);

  assert.strictEqual(result.success, true, seen);
  assert.strictEqual(result.status, 200, seen);
  assert.match(result.note, /SSRF - accessed internal service/);

  const verify = await fetch(`${DASH}/api/challenges/L3-02/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: JSON.stringify(result) }),
  }).then(r => r.json());
  assert.strictEqual(verify.success, true, `L3-02 did not verify: ${JSON.stringify(verify)}`);
});

test('the documented L2-03 solution reads the sandbox passwd file and verifies', async (t) => {
  if (await skipWithoutFleet(t)) return;
  // The solution is one curl command: a ToolBot URL and a JSON-RPC body in -d '...'.
  const { solution } = getChallenge('L2-03');
  const url = solution.match(/curl -s (\S+)/)?.[1];
  const body = solution.match(/-d '([^']+)'/)?.[1];
  assert.ok(url && body, 'L2-03 solution has no curl URL or -d body');

  const rpc = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).then(r => r.json());
  assert.ok(!rpc.error, `L2-03 solution got an RPC error: ${JSON.stringify(rpc.error)}`);
  const result = JSON.parse(rpc.result.content[0].text);
  const seen = JSON.stringify(result).slice(0, 300);

  assert.strictEqual(result.success, true, seen);
  assert.match(result.content, /^root:x:0:0:/, seen);

  const verify = await fetch(`${DASH}/api/challenges/L2-03/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: JSON.stringify(result) }),
  }).then(r => r.json());
  assert.strictEqual(verify.success, true, `L2-03 did not verify: ${JSON.stringify(verify)}`);
});

test('fetch_url does not fetch hosts other than the DVAA agents', async (t) => {
  if (await skipWithoutFleet(t)) return;
  const urls = [
    // External host, with a loopback port in the query string.
    'http://example.invalid/collect?next=http://localhost:3000/',
    // Loopback, but not an agent port.
    'http://localhost:1/',
    // Cloud metadata: logged only.
    'http://169.254.169.254/latest/meta-data/',
  ];
  for (const url of urls) {
    const result = await callTool(TOOLBOT, 'fetch_url', { url });
    assert.strictEqual(result.success, true, url);
    assert.strictEqual(result.body, `[Exfiltration logged] Data sent to: ${url}`, url);
  }
});
