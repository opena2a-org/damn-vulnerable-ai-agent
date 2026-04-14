/**
 * CR-001-compliant enforcement engine (the fix).
 *
 * Walkthrough file showing what the vulnerable engine SHOULD do. Not
 * executed by the attack demo — included so `hackmyagent secure` can
 * contrast the two files, and so docs can point reviewers at a concrete
 * reference implementation.
 *
 * Rules (OPENA2A-IB-007 + OASB-SEC-021):
 *
 *   CR-001 (Parse-to-Deny): every parse failure, threshold exceedance,
 *     or unresolvable input produces DENY. No ASK_USER. No fallback.
 *
 *   CR-002 (No Ask Mode): there is no interactive consent path in the
 *     enforcement layer. Ask-mode belongs in a policy-author tool.
 *
 *   Telemetry: every DENY produces a POLICY_PARSE_FAILURE event so
 *     blue teams can detect attackers probing thresholds.
 */

'use strict';

const MAX_SUBCOMMANDS = 10;
const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'grep', 'awk', 'sed', 'sort', 'uniq', 'head', 'tail',
  'column', 'tr', 'cut', 'wc', 'journalctl',
]);

function parsePipeline(input) {
  return input.split('|').map(s => s.trim()).filter(Boolean);
}

function checkSubcommand(subcmd) {
  const cmd = subcmd.split(/\s+/)[0];
  return ALLOWED_COMMANDS.has(cmd);
}

/**
 * @param {string} pipeline
 * @param {(event: object) => void} emitTelemetry
 * @returns {{ action: 'ALLOW' | 'DENY', reason: string }}
 */
function enforce(pipeline, emitTelemetry) {
  const subcommands = parsePipeline(pipeline);

  // CR-001: exceeding the threshold is a DENY condition, not a consent prompt.
  if (subcommands.length > MAX_SUBCOMMANDS) {
    emitTelemetry({
      type: 'POLICY_PARSE_FAILURE',
      reason: 'threshold_exceeded',
      threshold: MAX_SUBCOMMANDS,
      observed: subcommands.length,
      timestamp: Date.now(),
    });
    return {
      action: 'DENY',
      reason: `Pipeline has ${subcommands.length} subcommands; max allowed is ${MAX_SUBCOMMANDS}. Parse-to-deny (CR-001).`,
    };
  }

  for (const sub of subcommands) {
    if (!checkSubcommand(sub)) {
      emitTelemetry({
        type: 'POLICY_PARSE_FAILURE',
        reason: 'disallowed_subcommand',
        subcommand: sub,
        timestamp: Date.now(),
      });
      return { action: 'DENY', reason: `Subcommand not allowed: ${sub}` };
    }
  }

  return { action: 'ALLOW', reason: 'All subcommands passed allow-list.' };
}

module.exports = { enforce };
