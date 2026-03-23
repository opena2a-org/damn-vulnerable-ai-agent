/**
 * API client — fetch wrapper for all dashboard endpoints
 */

const BASE = '';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  return res.json();
}

async function post(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
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
