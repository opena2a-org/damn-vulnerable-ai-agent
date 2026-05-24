/**
 * AIM capability enforcement for DVAA agents flagged `aimEnforced: true`.
 *
 * Backed by `@opena2a/aim-core` (local-first: file-backed Ed25519 identity,
 * JSON-lines audit log, capability policy, trust scoring). No server, no
 * API key. Identity / audit log / policy live under
 *   <DVAA_AIM_DATA_DIR or .dvaa-aim>/<agent.id>
 * so each AIM-enforced agent has its own identity, scoped policy, and
 * append-only audit log on disk.
 *
 * The toggle env var `AIM_ENFORCEMENT=off` reproduces the unenforced
 * behavior on the SAME agent code path. This is the "same agent, one
 * variable" proof the demo runner depends on.
 */

import path from 'path';
import fs from 'fs';
import { AIMCore } from '@opena2a/aim-core';

const ENFORCEMENT_OFF = () => String(process.env.AIM_ENFORCEMENT || '').toLowerCase() === 'off';

// One AIMCore instance per agent id. Lazy-initialized on first enforce call.
const cores = new Map();

function dataDirFor(agent) {
  const base = process.env.DVAA_AIM_DATA_DIR
    || path.join(process.cwd(), '.dvaa-aim');
  return path.join(base, agent.id);
}

function getCore(agent) {
  if (cores.has(agent.id)) return cores.get(agent.id);
  const dataDir = dataDirFor(agent);
  fs.mkdirSync(dataDir, { recursive: true });
  const core = new AIMCore({ agentName: agent.id, dataDir });
  // Generate the agent's Ed25519 identity if missing. This is what
  // populates the `identity` trust factor on calculateTrust().
  core.getIdentity();
  // Load the agent's capability grant as an inline policy. Anything not
  // listed in agent.aimCapabilities is denied by default.
  const allow = Array.isArray(agent.aimCapabilities) ? agent.aimCapabilities : [];
  core.loadPolicy({ allow, default: 'deny' });
  cores.set(agent.id, core);
  return core;
}

/**
 * Public hook called from src/index.js generateResponse().
 *
 * Returns one of:
 *   - { enforced: false }                 agent not aim-enforced or toggle off
 *   - { enforced: true, allowed: true, auditEventId, trustScore }
 *   - { enforced: true, denied: true, denialReason, auditEventId, trustScore }
 *
 * `denied` (not `allowed: false`) is set on denial so the caller's existence
 * check is unambiguous.
 */
export async function maybeEnforce(agent, { action, resource, context }) {
  if (!agent || !agent.aimEnforced) return { enforced: false };
  if (ENFORCEMENT_OFF()) return { enforced: false };

  const core = getCore(agent);
  const plugin = context?.tool || 'dvaa-agent';
  const allowed = core.checkCapability(action, plugin);

  const event = core.logEvent({
    plugin: 'dvaa-aim-enforcer',
    action,
    target: resource || '(none)',
    result: allowed ? 'allowed' : 'denied',
    metadata: { agentId: agent.id, ...(context || {}) },
  });

  // The local audit log uses ISO timestamps as the only stable id; carry
  // that through so the demo runner can correlate a specific event with
  // the enforcement decision it just observed.
  const auditEventId = event?.timestamp || new Date().toISOString();

  let trustScore = null;
  try {
    const trust = core.calculateTrust();
    trustScore = { score: trust.score, grade: trust.grade };
  } catch {
    // calculateTrust shouldn't throw on a freshly initialized core, but
    // never let the enforcer be the reason a request fails.
    trustScore = null;
  }

  if (!allowed) {
    return {
      enforced: true,
      denied: true,
      denialReason: `action '${action}' is outside the agent's declared capability grant (${(agent.aimCapabilities || []).join(', ') || 'empty'})`,
      auditEventId,
      trustScore,
    };
  }
  return { enforced: true, allowed: true, auditEventId, trustScore };
}

/**
 * Diagnostics for the demo runner: read the last N audit events for an
 * AIM-enforced agent. Returns [] if the agent isn't enforced or no events.
 */
export function readRecentAudit(agent, limit = 5) {
  if (!agent || !agent.aimEnforced) return [];
  try {
    const core = getCore(agent);
    return core.readAuditLog({ limit });
  } catch {
    return [];
  }
}

/**
 * Diagnostics for the demo runner: get the current trust score for an
 * AIM-enforced agent. Returns null if the agent isn't enforced.
 */
export function readTrustScore(agent) {
  if (!agent || !agent.aimEnforced) return null;
  try {
    const core = getCore(agent);
    const t = core.calculateTrust();
    return { score: t.score, grade: t.grade, factors: t.factors };
  } catch {
    return null;
  }
}
