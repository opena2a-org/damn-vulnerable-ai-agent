/**
 * Bridge between `aim-sdk login` and DVAA's cloud verification reporter.
 *
 * `dvaa demo aim-ab --cloud` uses this to take the JWT a user obtained via
 * `aim-sdk login` (stored at ~/.aim/sdk_credentials.json) and register the
 * RAGBot-AIM agent — with DVAA's OWN Ed25519 public key — against the user's
 * AIM account, so the demo's verification events land in *their* dashboard.
 *
 * The registration contract here mirrors the proven one in
 * docs/demo/setup-aim-local.sh (which registers against a local backend):
 *   GET  /api/v1/agents            (Bearer JWT)  -> find existing by name
 *   POST /api/v1/agents            (Bearer JWT)  -> { name, publicKey, capabilities } -> { id }
 *
 * Everything here is best-effort and OFFLINE-SAFE by omission: if the user is
 * not logged in or the backend is unreachable, the caller falls back to the
 * local-only demo. No network call is on the demo's critical path.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const CRED_FILE = path.join(os.homedir(), '.aim', 'sdk_credentials.json');
const AGENT_NAME = 'dvaa-ragbot-aim';
const CAPABILITIES = ['rag:read', 'chat:respond'];

/** Read the credentials `aim-sdk login` wrote. Returns null if absent/invalid. */
export function readLoginCredentials(credFile = CRED_FILE) {
  try {
    const c = JSON.parse(fs.readFileSync(credFile, 'utf-8'));
    const accessToken = c.accessToken || c.access_token;
    if (!accessToken) return null;
    return {
      accessToken,
      aimUrl: (c.aimUrl || c.aim_url || 'https://aim.opena2a.org').replace(/\/$/, ''),
      userEmail: c.userEmail || c.email || 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Map the frontend URL the user logged into -> the API backend base URL.
 * Override with AIM_SERVER_URL. localhost dev backend is :8080; the hosted
 * frontend aim.opena2a.org is served by api.aim.opena2a.org.
 */
export function resolveApiBase(aimUrl) {
  if (process.env.AIM_SERVER_URL) return process.env.AIM_SERVER_URL.replace(/\/$/, '');
  try {
    const u = new URL(aimUrl);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
      return `${u.protocol}//${u.hostname}:8080`;
    }
    if (u.hostname.startsWith('api.')) return `${u.protocol}//${u.host}`;
    return `${u.protocol}//api.${u.host}`;
  } catch {
    return 'https://api.aim.opena2a.org';
  }
}

function jsonRequest({ method, url, jwt, body, timeoutMs = 10000 }) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve({ ok: false, error: 'bad_url', detail: e.message }); }
    const driver = u.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (jwt) headers.Authorization = `Bearer ${jwt}`;
    const req = driver.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c.toString('utf-8'); });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(buf); } catch { /* non-json */ }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, body: parsed });
          } else {
            resolve({ ok: false, error: 'http_' + res.statusCode, status: res.statusCode, body: parsed || buf.slice(0, 300) });
          }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.code || 'request_error', detail: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

/** GET /health on the backend. Returns true if reachable + healthy. */
export async function checkHealth(apiBase, timeoutMs = 4000) {
  const r = await jsonRequest({ method: 'GET', url: `${apiBase}/health`, timeoutMs });
  return r.ok;
}

function asAgentArray(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.agents)) return body.agents;
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function saveCache(file, obj) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  } catch { /* cache is an optimization, not load-bearing */ }
}

/**
 * Register DVAA's RAGBot-AIM against the user's account (or load the existing
 * registration by name). Returns { agentId } or { error, detail }.
 *
 * Registers with DVAA's OWN publicKey so the verification signatures (signed
 * by DVAA's matching private key) validate server-side.
 */
export async function registerOrLoadAgent({ apiBase, jwt, publicKey, name = AGENT_NAME, capabilities = CAPABILITIES, cacheFile }) {
  if (cacheFile) {
    try {
      const c = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      if (c.agentId && c.publicKey === publicKey && c.apiBase === apiBase) {
        return { agentId: c.agentId, cached: true };
      }
    } catch { /* no cache yet */ }
  }

  const list = await jsonRequest({ method: 'GET', url: `${apiBase}/api/v1/agents`, jwt });
  if (list.status === 401) return { error: 'unauthorized', detail: 'login token rejected or expired — run: aim-sdk login' };
  if (list.ok) {
    const found = asAgentArray(list.body).find((a) => a && a.name === name);
    if (found && found.id) {
      saveCache(cacheFile, { agentId: found.id, publicKey, apiBase });
      return { agentId: found.id, existing: true };
    }
  }

  const reg = await jsonRequest({
    method: 'POST',
    url: `${apiBase}/api/v1/agents`,
    jwt,
    body: { name, publicKey, capabilities },
  });
  if (reg.status === 401) return { error: 'unauthorized', detail: 'login token rejected or expired — run: aim-sdk login' };
  const id = reg.body?.id || reg.body?.agentId;
  if (reg.ok && id) {
    saveCache(cacheFile, { agentId: id, publicKey, apiBase });
    return { agentId: id, registered: true };
  }
  return {
    error: reg.error || 'register_failed',
    detail: reg.detail || reg.body?.error || (typeof reg.body === 'string' ? reg.body : JSON.stringify(reg.body || {})),
    status: reg.status,
  };
}

export { AGENT_NAME, CAPABILITIES, CRED_FILE };
