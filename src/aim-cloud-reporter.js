/**
 * Cloud-mode reporter for the AIM dashboard at api.aim.opena2a.org.
 *
 * Local-first enforcement via aim-core remains authoritative. This module
 * is purely additive: when the cloud env vars are set, every enforcement
 * decision is mirrored as a signed verification request to the cloud so
 * the dashboard can show the registered agent + audit events + trust score.
 *
 * Activation gates (ALL three required to enable cloud reporting):
 *   - process.env.AIM_SERVER_URL (e.g. https://api.aim.opena2a.org)
 *   - process.env.AIM_API_KEY (any aim_live_/aim_test_ key, used as X-API-Key)
 *   - process.env.DVAA_AIM_CLOUD_AGENT_ID (UUID returned by the dashboard
 *     when the agent was registered with this DVAA install's public key)
 *
 * Without all three, the reporter no-ops. The local audit log + capability
 * decision still happens regardless.
 *
 * Contract matches the Python SDK at aim_sdk/client.py:504-620
 * (verify_capability). The signature payload uses 'action_type' (Python
 * legacy field name) while the request body uses 'capability'. JSON
 * serialization MUST match Python's json.dumps(sort_keys=True,
 * separators=(', ', ': ')) — that's the canonical bytes the server
 * re-serializes and verifies.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

const VERIFICATIONS_PATH = '/api/v1/sdk-api/verifications';

export function cloudReporterEnabled() {
  return Boolean(
    process.env.AIM_SERVER_URL &&
    process.env.AIM_API_KEY &&
    process.env.DVAA_AIM_CLOUD_AGENT_ID,
  );
}

/**
 * Python-compatible JSON serialization.
 *
 * Python: json.dumps(obj, sort_keys=True, separators=(', ', ': '))
 *   - keys sorted at every nesting level
 *   - comma followed by space between items
 *   - colon followed by space between key and value
 *
 * Node JSON.stringify has neither sorted keys nor configurable separators,
 * so we walk the object ourselves.
 */
export function pythonJsonStringify(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number not JSON-serializable');
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(pythonJsonStringify).join(', ') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ': ' + pythonJsonStringify(value[k])).join(', ') + '}';
  }
  throw new Error('unsupported type for JSON: ' + typeof value);
}

/**
 * Sign + POST one verification request to the cloud.
 *
 * `signFn` is a function (Buffer-or-string -> Buffer-or-Uint8Array) — pass
 * `core.sign.bind(core)` where `core` is the same AIMCore instance the
 * enforcer is already using. This guarantees the signature comes from the
 * SAME private key the dashboard agent was registered with.
 *
 * Returns { ok: true, verificationId, verified, status } on success,
 * { ok: false, error, status, body? } on failure. Never throws — the
 * cloud is best-effort; local enforcement already happened.
 */
export async function postVerification({
  serverUrl,
  cloudAgentId,
  publicKey,
  signFn,
  apiKey,
  action,
  resource,
  context,
  result,
  timeoutMs = 5000,
}) {
  if (!serverUrl || !cloudAgentId || !publicKey || typeof signFn !== 'function') {
    return { ok: false, error: 'missing_config' };
  }

  const timestamp = new Date().toISOString();

  // Signature payload — MUST use 'action_type' (server expects legacy field).
  // Keys are sorted by pythonJsonStringify.
  const signaturePayload = {
    action_type: action,
    agent_id: cloudAgentId,
    context: context || {},
    resource: resource || null,
    timestamp,
  };
  const signatureMessage = pythonJsonStringify(signaturePayload);

  let signatureB64;
  try {
    const sigBytes = signFn(Buffer.from(signatureMessage, 'utf-8'));
    signatureB64 = Buffer.from(sigBytes).toString('base64');
  } catch (e) {
    return { ok: false, error: 'sign_failed', detail: e.message };
  }

  // Request body — uses 'capability' (live field name) + signature + publicKey.
  const requestBody = JSON.stringify({
    agentId: cloudAgentId,
    capability: action,
    resource: resource || null,
    context: context || {},
    timestamp,
    signature: signatureB64,
    publicKey,
    // Local enforcement result for the dashboard's records — even though
    // the cloud will independently decide based on the capability rules
    // associated with the registered agent.
    enforcementResult: result || 'unknown',
  });

  return await postBody({ serverUrl, path: VERIFICATIONS_PATH, body: requestBody, apiKey, timeoutMs });
}

function postBody({ serverUrl, path, body, apiKey, timeoutMs }) {
  let url;
  try { url = new URL(path, serverUrl); } catch (e) {
    return Promise.resolve({ ok: false, error: 'invalid_server_url', detail: e.message });
  }
  const driver = url.protocol === 'https:' ? https : http;
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'User-Agent': 'dvaa-aim-enforcer/0.8.3',
  };
  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }
  return new Promise((resolve) => {
    const req = driver.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        let buf = '';
        res.on('data', (chunk) => { buf += chunk.toString('utf-8'); });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(buf); } catch { parsed = null; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              ok: true,
              status: res.statusCode,
              verificationId: parsed?.id || parsed?.verification_id || parsed?.verificationId || null,
              verified: parsed?.verified ?? (parsed?.status === 'auto-approved' || parsed?.status === 'approved'),
              cloudStatus: parsed?.status ?? null,
              cloudTrustScore: parsed?.trustScore ?? null,
              body: parsed,
            });
          } else {
            resolve({
              ok: false,
              error: 'http_' + res.statusCode,
              status: res.statusCode,
              body: parsed || buf.slice(0, 400),
            });
          }
        });
      },
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.code || 'request_error', detail: e.message }));
    req.write(body);
    req.end();
  });
}
