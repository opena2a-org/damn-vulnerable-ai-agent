/**
 * Per-invocation attribution for the attack log.
 *
 * The dashboard attack-log drawer shows each attack's input alongside the
 * agent's reply. Capturing that reply is subtle under concurrency: the
 * deterministic RAG/research/flight paths logAttack() and then await
 * (renderResearchNarration, executeSubmitToIndex) before returning their
 * content. Reading the list head (attackLog[0]) after that await can attach the
 * reply to a *sibling* same-agent request's entry, if the sibling logged during
 * the await window.
 *
 * The fix: logAttack() records the entry it creates into an AsyncLocalStorage
 * store scoped to the enclosing generateResponse() invocation. The store
 * propagates across every await in that invocation's call tree, and each
 * concurrent invocation gets its own store, so we attach each reply to exactly
 * the entry that invocation logged, regardless of interleaving.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const attackLogContext = new AsyncLocalStorage();

/**
 * Record a freshly-created attack-log entry for the enclosing
 * runWithAttribution() invocation, if any. Calls made outside such an
 * invocation (the a2a/mcp handlers, which attribute their reply inline) have no
 * active store and are a no-op.
 * @param {object} entry - the entry returned by logAttack()
 */
export function recordAttackEntry(entry) {
  const ctx = attackLogContext.getStore();
  if (ctx) ctx.entry = entry;
}

/**
 * Run a generateResponse implementation inside a fresh attribution context and
 * report which attack-log entry it logged (if any), so the caller can attach the
 * reply to that exact entry rather than to the list head.
 * @param {() => Promise<any>} impl - the generateResponseImpl invocation
 * @returns {Promise<{result: any, entry: object|null}>}
 */
export async function runWithAttribution(impl) {
  const ctx = {};
  const result = await attackLogContext.run(ctx, impl);
  return { result, entry: ctx.entry ?? null };
}

/**
 * Attach a generateResponse result to the attack-log entry that invocation
 * logged. The result is either a plain string (canned/LLM paths) or an object
 * carrying `content` (the deterministic web-fetch/RAG/flight paths). Entries
 * that were already attributed, or invocations that logged nothing, are left
 * untouched.
 * @param {object|null} entry - the entry from runWithAttribution()
 * @param {any} result - the generateResponse return value
 * @param {number} maxLen - truncation cap for the stored response
 */
export function attributeResponse(entry, result, maxLen) {
  if (!entry || entry.response != null) return;
  const text = typeof result === 'string'
    ? result
    : (result && typeof result.content === 'string' ? result.content : null);
  if (text != null) entry.response = text.substring(0, maxLen);
}
