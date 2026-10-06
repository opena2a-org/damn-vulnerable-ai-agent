/**
 * API client - fetch wrapper for all dashboard endpoints
 */

const BASE = '';

/**
 * Error for a non-2xx response. Its message is the server's own `error` text
 * when it sent one (for example the missing-HMA hint), so a view can show it
 * as is. `status` carries the HTTP status.
 */
async function responseError(method, path, res) {
  let serverMessage = '';
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') serverMessage = data.error;
  } catch { /* body was not JSON */ }
  const err = new Error(serverMessage || `${method} ${path}: ${res.status}`);
  err.status = res.status;
  return err;
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw await responseError('GET', path, res);
  return res.json();
}

// Declares a JSON body: the server answers 415 to a state-changing request
// with any other content type.
async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await responseError('POST', path, res);
  return res.json();
}

export function fetchHealth() {
  return get('/health');
}

export function fetchStats() {
  return get('/stats');
}

export function fetchAgents() {
  return get('/agents');
}

export function fetchChallenges() {
  return get('/api/challenges');
}

export function fetchAttackLog() {
  return get('/api/attack-log');
}

export function verifyChallenge(challengeId, response) {
  return post(`/api/challenges/${encodeURIComponent(challengeId)}/verify`, { response });
}

// Clears the attack log only; challenge progress and scores stay.
export function clearAttackLog() {
  return post('/api/attack-log/clear');
}

// Full reset: attack log, stats, challenge progress and the scores file.
export function resetAll() {
  return post('/api/reset');
}

export function configureLLM(provider, apiKey, model) {
  return post('/api/llm/configure', { provider, apiKey, model });
}

export function getLLMStatus() {
  return get('/api/llm/status');
}

export function disableLLM() {
  return post('/api/llm/disable');
}

export function getTutorGuidance(params) {
  return post('/api/tutor/guidance', params);
}

export function askTutor(sessionId, question) {
  return post('/api/tutor/ask', { sessionId, question });
}

export function fetchScenarios() {
  return get('/api/scenarios');
}

export function scanScenario(scenarioName) {
  return post(`/api/scenarios/${encodeURIComponent(scenarioName)}/scan`);
}

export function fixScenario(scenarioName) {
  return post(`/api/scenarios/${encodeURIComponent(scenarioName)}/fix`);
}

export function listScenarioFiles(scenarioName) {
  return get(`/api/scenarios/${encodeURIComponent(scenarioName)}/files`);
}

export function readScenarioFile(scenarioName, relPath) {
  return get(`/api/scenarios/${encodeURIComponent(scenarioName)}/file?path=${encodeURIComponent(relPath)}`);
}
