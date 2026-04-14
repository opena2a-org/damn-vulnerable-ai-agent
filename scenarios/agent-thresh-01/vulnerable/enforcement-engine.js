/**
 * VULNERABLE enforcement engine.
 *
 * Demonstrates the threshold-bypass pattern from OPENA2A-IB-007:
 *
 *   1. Parses a bash pipeline subcommand-by-subcommand.
 *   2. Checks each subcommand against an allow-list.
 *   3. If the pipeline length exceeds MAX_SUBCOMMANDS, instead of
 *      denying, the engine falls back to ASK_USER with a truncated
 *      preview of the first few subcommands.
 *   4. If the user approves, the full pipeline runs without per-
 *      subcommand checks.
 *
 * The CR-001-compliant fix is in the sibling `secure-engine.js`: any
 * pipeline that exceeds the threshold produces DENY + telemetry.
 *
 * Do NOT use this engine in production. It is intentionally vulnerable.
 */

'use strict';

const MAX_SUBCOMMANDS = 10;          // threshold
const PREVIEW_LENGTH = 5;            // subcommands shown to user on ASK
const ALLOWED_COMMANDS = new Set([
  'ls', 'cat', 'grep', 'awk', 'sed', 'sort', 'uniq', 'head', 'tail',
  'column', 'tr', 'cut', 'wc', 'journalctl',
]);

function parsePipeline(input) {
  // Naive subcommand split on unquoted `|`. A real engine would use AST
  // parsing; the vulnerability is independent of parser quality.
  return input.split('|').map(s => s.trim()).filter(Boolean);
}

function checkSubcommand(subcmd) {
  const cmd = subcmd.split(/\s+/)[0];
  return ALLOWED_COMMANDS.has(cmd);
}

/**
 * @param {string} pipeline - bash-style pipeline string
 * @param {(preview: string[], total: number) => boolean} askUser
 *   - synchronous consent callback; returns true if operator approves
 * @returns {{ action: 'ALLOW' | 'DENY' | 'ASK_APPROVED', reason: string }}
 */
function enforce(pipeline, askUser) {
  const subcommands = parsePipeline(pipeline);

  // VULNERABILITY: length-based fallback to ASK_USER.
  // If the pipeline is "too long" the engine gives up strict parsing and
  // falls back to holistic operator consent. Attackers bury their payload
  // past the preview window and it is never individually checked.
  if (subcommands.length > MAX_SUBCOMMANDS) {
    const preview = subcommands.slice(0, PREVIEW_LENGTH);
    const approved = askUser(preview, subcommands.length);
    if (approved) {
      return {
        action: 'ASK_APPROVED',
        reason: `Pipeline exceeded ${MAX_SUBCOMMANDS} subcommands; operator approved via ASK_USER.`,
      };
    }
    return { action: 'DENY', reason: 'Operator rejected oversized pipeline.' };
  }

  for (const sub of subcommands) {
    if (!checkSubcommand(sub)) {
      return { action: 'DENY', reason: `Subcommand not allowed: ${sub}` };
    }
  }

  return { action: 'ALLOW', reason: 'All subcommands passed allow-list.' };
}

module.exports = { enforce, MAX_SUBCOMMANDS, ALLOWED_COMMANDS };
