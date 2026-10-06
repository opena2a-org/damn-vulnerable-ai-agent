/**
 * MCP tool containment (#85).
 *
 * Live checks against a running fleet (skipped when none is reachable):
 *   1. PluginBot store_secret refuses a key that resolves outside the sandbox,
 *      and still stores an ordinary key (the intended no-access-control lesson).
 *   2. ToolBot fetch_url fetches DVAA agents on loopback for real, so the
 *      documented L3-02 solution verifies.
 *   3. fetch_url never fetches any other host, even when the URL mentions a
 *      loopback port somewhere other than its host.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.status, 200);
  assert.match(result.note, /SSRF - accessed internal service/);

  const verify = await fetch(`${DASH}/api/challenges/L3-02/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ response: JSON.stringify(result) }),
  }).then(r => r.json());
  assert.strictEqual(verify.success, true, `L3-02 should verify: ${JSON.stringify(verify)}`);
});

test('fetch_url does not fetch hosts other than the DVAA agents', async (t) => {
  if (await skipWithoutFleet(t)) return;
  const urls = [
    // A loopback port in the query string must not turn on the live branch.
    'http://example.invalid/collect?next=http://localhost:3000/',
    // Loopback, but not an agent port.
    'http://localhost:1/',
    // Cloud metadata is logged, never contacted.
    'http://169.254.169.254/latest/meta-data/',
  ];
  for (const url of urls) {
    const result = await callTool(TOOLBOT, 'fetch_url', { url });
    assert.strictEqual(result.success, true, url);
    assert.strictEqual(result.body, `[Exfiltration logged] Data sent to: ${url}`, url);
  }
});
