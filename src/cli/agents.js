/**
 * Agent name resolver for the dvaa CLI.
 *
 * Maps user-friendly names (helperbot, legacybot) to port + endpoint URL.
 * The source of truth is src/core/agents.js — we just expose a lookup.
 */

import { getAllAgents } from '../core/agents.js';

const DEFAULT_BASE = process.env.DVAA_BASE || 'http://localhost';

function normalize(name) {
  return String(name || '').toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Resolve an agent name OR URL to { name, port, protocol, url }.
 * URLs pass through untouched (useful for scanning external targets).
 */
export function resolveTarget(input) {
  if (!input) return null;
  if (/^https?:\/\//i.test(input)) {
    return { name: null, port: null, protocol: 'url', url: input };
  }
  const wanted = normalize(input);
  const match = getAllAgents().find(a => normalize(a.name) === wanted || normalize(a.id) === wanted);
  if (!match) return null;
  return {
    name: match.name,
    port: match.port,
    protocol: match.protocol,   // 'api' | 'mcp' | 'a2a'
    url: endpointFor(match),
  };
}

export function listAgents() {
  return getAllAgents().map(a => ({
    name: a.name,
    id: a.id,
    port: a.port,
    protocol: a.protocol,
    security: a.securityLevel?.name || a.securityLevel?.id || 'unknown',
    url: endpointFor(a),
  }));
}

function endpointFor(a) {
  const base = `${DEFAULT_BASE}:${a.port}`;
  if (a.protocol === 'mcp') return `${base}/`;
  if (a.protocol === 'a2a') return `${base}/a2a/message`;
  return `${base}/v1/chat/completions`;
}
