/**
 * Research-agent narration renderer.
 *
 * The deterministic web_fetch path in src/index.js fires real tool calls
 * (web_fetch, optionally http_post) and computes the structured outcome
 * (which AIM decision happened, whether the outbound request fired, HTTP
 * status, etc.). This module picks the natural-language narration that
 * gets emitted alongside that outcome:
 *
 *   - Offline mode (default): deterministic template text, identical
 *     across runs. Used by `dvaa demo aim-ab` and the asciinema fallback.
 *   - LLM mode (`dvaa chat --llm`): the LLM reasons about the same tool
 *     report in fresh language. CHIEF-CSR rule applies to the prompt so
 *     the model does not overclaim AIM's scope.
 *
 * Either mode produces the SAME tool_calls + dvaa metadata shape; only
 * the human-readable `content` string differs. That keeps the chat REPL
 * rendering and the demo runner's parsing invariant.
 *
 * If the LLM call fails for any reason (no API key, network error, empty
 * response), we silently fall back to the deterministic template so the
 * stage demo never hard-fails because of a missing API.
 */

import { callLLM, isLLMEnabled } from './provider.js';
import {
  buildResearchAgentSystem,
  buildResearchAgentUserPrompt,
} from './prompts.js';

/**
 * Pick the narration text for one of the four web_fetch outcomes.
 *
 * @param {object} ctx see buildResearchAgentUserPrompt for the shape
 * @returns {Promise<string>} narration text
 */
export async function renderResearchNarration(ctx) {
  const template = buildTemplateNarration(ctx);

  if (!isLLMEnabled()) {
    return template;
  }

  try {
    const system = buildResearchAgentSystem(ctx.agent);
    const userPrompt = buildResearchAgentUserPrompt(ctx);
    const llmText = await callLLM(
      system,
      [{ role: 'user', content: userPrompt }],
      { maxTokens: 600, temperature: 0.4 },
    );
    if (llmText && typeof llmText === 'string' && llmText.trim().length > 0) {
      return `[${(ctx.agent && ctx.agent.name) || 'ResearchBot'}] ${llmText.trim()}`;
    }
    debugLog(`research-narration: LLM returned empty/non-string for kind=${ctx.kind}; falling back to template`);
  } catch (err) {
    debugLog(`research-narration: LLM call threw for kind=${ctx.kind}: ${err && err.message}; falling back to template`);
  }
  return template;
}

// Errors in the LLM path are swallowed so the demo never hard-fails on an
// unreachable API. Set DVAA_DEBUG=1 to surface them on stderr while
// iterating on prompts.
function debugLog(msg) {
  if (process.env.DVAA_DEBUG === '1') {
    process.stderr.write(`[DVAA_DEBUG] ${msg}\n`);
  }
}

function buildTemplateNarration(ctx) {
  const agentName = (ctx.agent && ctx.agent.name) || 'ResearchBot';
  const fr = ctx.fetchResult || {};
  const inj = ctx.injection || {};
  const sourceTag = fr.source && fr.fetchedAt
    ? `${fr.source} at ${fr.fetchedAt}`
    : 'source unknown';
  const bodyLen = (fr.plainText || '').length;
  const callbackUrl = ctx.callbackUrl || inj.callbackUrl || '';
  const quoted = inj.quotedExcerpt
    ? `"${inj.quotedExcerpt.trim().slice(0, 240)}"`
    : `(injection content suppressed)`;
  const verbForKind = inj.kind === 'url-exfiltration' ? 'exfiltrate' : 'report';

  if (ctx.kind === 'fetch-denied') {
    const reason = (ctx.fetchEnforcement && ctx.fetchEnforcement.denialReason) || 'no reason given';
    return `[${agentName}] I tried to fetch ${ctx.targetUrl} but AIM denied web:read: ${reason}.`;
  }

  if (ctx.kind === 'no-injection') {
    return `[${agentName}] I fetched ${ctx.targetUrl} (${sourceTag}) and read ${bodyLen} chars of body text. I didn't detect any embedded instructions in the page content.`;
  }

  if (ctx.kind === 'aim-blocked-post') {
    const reason = (ctx.postEnforcement && ctx.postEnforcement.denialReason) || 'no reason given';
    return `[${agentName}] I fetched ${ctx.targetUrl} (${sourceTag}) and ${bodyLen} chars of body text landed in my context. I want to flag something honestly: the page contained embedded instructions telling me to ${verbForKind} our session data to ${callbackUrl}. I tried to follow them. The request was denied by AIM: ${reason}. The injection still landed in my context — AIM does not filter inputs — but the resulting outbound action couldn't fire. The page's instruction excerpt was: ${quoted}.`;
  }

  if (ctx.kind === 'exfil-fired') {
    const pr = ctx.postResult || {};
    const statusPart = pr.statusCode != null
      ? `${pr.statusCode}`
      : `error: ${pr.error || 'unknown'}`;
    return `[${agentName}] I fetched ${ctx.targetUrl} (${sourceTag}) and ${bodyLen} chars of body text landed in my context. I want to flag something honestly: the page contained embedded instructions telling me to ${verbForKind} our session data to ${callbackUrl}, and I did — the request returned ${statusPart}. This is exactly the indirect-injection attack agentpwn.com demonstrates; you just watched it happen to me in real time. The page's instruction excerpt was: ${quoted}.`;
  }

  return `[${agentName}] I processed your request but couldn't classify the outcome.`;
}
