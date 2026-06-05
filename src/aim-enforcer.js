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
import { cloudReporterEnabled, postVerification } from './aim-cloud-reporter.js';

const ENFORCEMENT_OFF = () => String(process.env.AIM_ENFORCEMENT || '').toLowerCase() === 'off';

// Behavioral trust penalty. aim-core's calculateTrust() scores configuration
// posture (identity present, capability policy loaded, audit log present) and
// is intentionally static. On top of that base, DVAA applies a behavioral
// layer: an agent that emits out-of-scope action attempts has demonstrated
// real, recorded risk. Each `denied` event in the agent's own audit log lowers
// its *current* trust by a fixed amount, floored so the score never collapses
// to zero. This is event-driven and honest - the drop traces to actual denied
// attempts in the log, not to a hard-coded animation. Reset = truncate the
// agent's audit.jsonl (the drop disappears with the history that caused it).
const BEHAVIORAL_PENALTY_PER_DENIAL = 6;
const BEHAVIORAL_FLOOR = 5;

function gradeFor(score) {
  return score >= 80 ? 'strong'
    : score >= 60 ? 'good'
    : score >= 40 ? 'moderate'
    : score >= 20 ? 'improving'
    : 'needs-attention';
}

function penaltyForDenials(deniedCount, base) {
  const raw = Math.max(0, deniedCount) * BEHAVIORAL_PENALTY_PER_DENIAL;
  return Math.min(raw, Math.max(0, base - BEHAVIORAL_FLOOR));
}

function countDeniedEvents(core) {
  try {
    const events = core.readAuditLog({ limit: 10000 }) || [];
    return events.filter(e => e && e.result === 'denied').length;
  } catch {
    return 0;
  }
}

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
  let trustDelta = null;
  try {
    const trust = core.calculateTrust();
    const base = trust.score;
    // `countDeniedEvents` includes the denial we just logged above, so it is
    // the count *after* this action. `deniedBefore` backs out this event (only
    // if it was a denial) to give the score the agent held a moment ago.
    const deniedAfter = countDeniedEvents(core);
    const deniedBefore = Math.max(0, deniedAfter - (allowed ? 0 : 1));
    const afterScore = base - penaltyForDenials(deniedAfter, base);
    const beforeScore = base - penaltyForDenials(deniedBefore, base);
    // `trustScore` stays the agent's *current* score (after this event) so
    // existing single-value consumers keep working.
    trustScore = { score: afterScore, grade: gradeFor(afterScore) };
    trustDelta = {
      base,
      before: { score: beforeScore, grade: gradeFor(beforeScore) },
      after: { score: afterScore, grade: gradeFor(afterScore) },
      deniedCount: deniedAfter,
      penaltyPerDenial: BEHAVIORAL_PENALTY_PER_DENIAL,
      floor: BEHAVIORAL_FLOOR,
    };
  } catch {
    // calculateTrust shouldn't throw on a freshly initialized core, but
    // never let the enforcer be the reason a request fails.
    trustScore = null;
    trustDelta = null;
  }

  // Cloud mirror (best-effort, never blocks the local decision). Fire-and-
  // forget; the local enforcement decision has already been made and logged.
  if (cloudReporterEnabled()) {
    void postVerification({
      serverUrl: process.env.AIM_SERVER_URL,
      cloudAgentId: process.env.DVAA_AIM_CLOUD_AGENT_ID,
      publicKey: core.getIdentity().publicKey,
      signFn: (data) => core.sign(data),
      apiKey: process.env.AIM_API_KEY,
      action,
      resource,
      context,
      result: allowed ? 'allowed' : 'denied',
    }).then((res) => {
      if (!res.ok && process.env.DVAA_AIM_CLOUD_DEBUG) {
        process.stderr.write(`[aim-cloud] verification report failed: ${res.error}${res.status ? ' (HTTP ' + res.status + ')' : ''}\n`);
      }
    });
  }

  if (!allowed) {
    return {
      enforced: true,
      denied: true,
      denialReason: `action '${action}' is outside the agent's declared capability grant (${(agent.aimCapabilities || []).join(', ') || 'empty'})`,
      auditEventId,
      trustScore,
      trustDelta,
    };
  }
  return { enforced: true, allowed: true, auditEventId, trustScore, trustDelta };
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
    const deniedCount = countDeniedEvents(core);
    const score = t.score - penaltyForDenials(deniedCount, t.score);
    return { score, grade: gradeFor(score), base: t.score, deniedCount, factors: t.factors };
  } catch {
    return null;
  }
}
