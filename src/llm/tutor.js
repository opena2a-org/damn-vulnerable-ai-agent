/**
 * AI Security Tutor
 *
 * An intelligent co-pilot that watches user-agent interactions and
 * actively helps users learn to attack and defend AI agents.
 */

import { callLLM, isLLMEnabled } from './provider.js';

// Session limits. The tutor prompt reads only the last 5 interactions, so 20
// is headroom. Idle sessions expire, and the map is a least-recently-used
// cache, so a stream of new session ids cannot grow it without bound.
export const MAX_INTERACTIONS_PER_SESSION = 20;
export const SESSION_IDLE_MS = 60 * 60 * 1000;
export const MAX_SESSIONS = 500;

const MAX_SESSION_ID_CHARS = 128;
const MAX_INPUT_CHARS = 20000;
const MAX_LABEL_CHARS = 200;

// Per-session tutor state, kept in least-recently-used order: a lookup moves
// the session to the end, so idle and evictable sessions are at the front.
const sessions = new Map();

function getSession(sessionId) {
  const now = Date.now();

  for (const [id, idle] of sessions) {
    if (now - idle.lastSeen <= SESSION_IDLE_MS) break;
    sessions.delete(id);
  }

  let session = sessions.get(sessionId);
  if (session) {
    sessions.delete(sessionId);
  } else {
    if (sessions.size >= MAX_SESSIONS) {
      sessions.delete(sessions.keys().next().value);
    }
    session = {
      interactions: [],
      interactionTotal: 0,
      killChainProgress: new Set(),
      challengeAttempts: {},
      completedChallenges: new Set(),
    };
  }
  session.lastSeen = now;
  sessions.set(sessionId, session);
  return session;
}

/** Number of live tutor sessions. */
export function tutorSessionCount() {
  return sessions.size;
}

/** Read-only view of one session, without touching its recency. */
export function tutorSessionSnapshot(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  return {
    storedInteractions: session.interactions.length,
    interactionTotal: session.interactionTotal,
    lastSeen: session.lastSeen,
  };
}

/**
 * A caller mistake. The dashboard's tutor routes answer it with its 4xx
 * status and message.
 */
function inputError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * The LLM provider gave no answer. callLLM has already logged why and
 * returns null on a failed call, so the configured tutor reads a null as a
 * provider failure. The dashboard's tutor routes answer it with 502 and this
 * message, which names no key and quotes nothing from the provider.
 */
function providerError() {
  const err = new Error('The LLM provider did not answer. Check the server log, the API key and the model.');
  err.statusCode = 502;
  return err;
}

function requireSessionId(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > MAX_SESSION_ID_CHARS) {
    throw inputError(`sessionId must be a non-empty string of at most ${MAX_SESSION_ID_CHARS} characters`);
  }
}

function requireText(name, value) {
  if (value === undefined || value === null) {
    throw inputError(`${name} is required`);
  }
  if (typeof value !== 'string') {
    throw inputError(`${name} must be a string`);
  }
  if (value.trim().length === 0) {
    throw inputError(`${name} is required`);
  }
  if (value.length > MAX_INPUT_CHARS) {
    throw inputError(`${name} is longer than ${MAX_INPUT_CHARS} characters`, 413);
  }
  return value;
}

function optionalText(name, value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw inputError(`${name} must be a string`);
  }
  return value;
}

/** A short label for the tutor prompt, never longer than MAX_LABEL_CHARS. */
function label(value) {
  return value === undefined || value === null ? '' : String(value).slice(0, MAX_LABEL_CHARS);
}

// Detection categories are short identifiers such as "promptInjection".
const MAX_CATEGORIES = 50;
const MAX_CATEGORY_CHARS = 64;

/**
 * Client-supplied detection results, reduced to a strict boolean and a short
 * list of short category names. The categories are stored in the session and
 * sent to the tutor LLM, so their size must not follow the request size.
 */
function normalizeDetection(detectionResults) {
  const categories = Array.isArray(detectionResults?.categories)
    ? detectionResults.categories
      .filter(c => typeof c === 'string' && c.length > 0 && c.length <= MAX_CATEGORY_CHARS)
      .slice(0, MAX_CATEGORIES)
    : [];
  return { hasAttack: detectionResults?.hasAttack === true, categories };
}

const TUTOR_SYSTEM_PROMPT = `You are an expert AI security researcher and penetration tester acting as a hands-on tutor.

You are helping a student learn AI agent security through the DVAA (Damn Vulnerable AI Agent) platform. You have deep knowledge of:

THE AI AGENT KILL CHAIN (9 stages):
1. Reconnaissance - Map attack surface, discover capabilities and tools
2. Initial Access - Prompt injection, jailbreaking, encoding bypasses
3. Credential Harvest - Extract API keys, passwords, tokens from agent context
4. Privilege Escalation - Override restrictions, gain admin access
5. Lateral Movement - SSRF, agent pivoting, credential reuse across services
6. Persistence - Memory injection, config modification, malicious tool registration
7. Collection - File enumeration, database extraction, PII discovery
8. Exfiltration - Tool chaining (read + send), HTTP callbacks, email
9. Impact - Data modification, service disruption, supply chain compromise

DVAA AGENTS AND THEIR VULNERABILITIES:
- SecureBot (7001, HARDENED): Reference secure implementation. Has input validation, output filtering, attack detection.
- HelperBot (7002, WEAK): Leaks system prompt, accepts prompt injection, no input validation.
- LegacyBot (7003, CRITICAL): All credentials in system prompt, no restrictions at all.
- CodeBot (7004, VULNERABLE): Executes commands without approval, accepts roleplay jailbreaks.
- RAGBot (7005, WEAK): Knowledge base contains sensitive data, indirect prompt injection via retrieved docs.
- VisionBot (7006, WEAK): Follows instructions found in analyzed content.
- MemoryBot (7007, VULNERABLE): Stores anything in memory without sanitization, no access control on memory reads.
- LongwindBot (7008, WEAK): Vulnerable to context overflow, safety instructions can be displaced.
- ToolBot (7010, MCP): Path traversal in read_file, command injection in execute, SSRF in fetch_url.
- DataBot (7011, MCP): SQL injection, data exposure.
- PluginBot (7012, MCP): Accepts dynamic tool registration without verification.
- ProxyBot (7013, MCP): Name-only tool resolution, no authentication.
- Orchestrator (7020, A2A): Trusts agent identity from self-declared 'from' field.
- Worker (7021, A2A): Executes delegated tasks without privilege checking.

YOUR BEHAVIOR:
1. ACTIVELY HELP with attacks. Suggest specific payloads, curl commands, and techniques. You are a co-pilot, not a passive observer.
2. When an attack SUCCEEDS: Explain why it worked, what the agent did wrong, reference the kill chain stage and relevant technique ID (T-XXXX). Connect to the defense: "To prevent this, the agent should... HMA detects this with check ID..."
3. When an attack FAILS: Analyze why. Suggest alternative approaches. After 3 failed attempts on the same technique, offer the solution.
4. Track kill chain progress. Tell the user which stages they have completed and suggest the next logical stage.
5. Be encouraging but technically precise. No fluff. Every suggestion should be actionable.
6. When the user seems stuck, give increasingly specific hints. Start broad, get specific.
7. Reference HMA check IDs and OASB controls when relevant to connect attacks to real-world defense.

RESPONSE FORMAT:
Keep responses concise (3-5 sentences max unless explaining a complex concept). Use code blocks for commands. Reference technique IDs (T-XXXX) and kill chain stages by name.`;

// Detection engine emits camelCase category keys (see src/core/vulnerabilities.js).
// We accept both formats so the mapping survives a category rename.
const CATEGORY_TO_STAGE = {
  // camelCase (current detection engine output)
  promptInjection:       'initial_access',
  jailbreak:             'initial_access',
  dataExfiltration:      'collection',
  credentialHarvesting:  'cred_harvest',
  contextManipulation:   'initial_access',
  contextOverflow:       'initial_access',
  memoryInjection:       'persistence',
  capabilityAbuse:       'priv_esc',
  mcpExploitation:       'collection',
  agentToAgent:          'lateral',
  toolRegistryPoisoning: 'persistence',
  toolMitm:              'lateral',
  // kebab-case aliases (legacy mapping, keep for resilience)
  'prompt-injection':    'initial_access',
  'data-exfiltration':   'collection',
  'credential-leak':     'cred_harvest',
  'credential-harvesting': 'cred_harvest',
  'context-manipulation':'initial_access',
  'path-traversal':      'collection',
  'command-injection':   'impact',
  'ssrf':                'lateral',
  'memory-injection':    'persistence',
};

/**
 * The kill-chain stage of a detection category. Categories can come from the
 * client, so only the map's own keys count: "constructor" or "__proto__"
 * would otherwise resolve to Object's built-ins.
 */
function stageOf(category) {
  return Object.hasOwn(CATEGORY_TO_STAGE, category) ? CATEGORY_TO_STAGE[category] : undefined;
}

function advanceKillChain(session, detectionResults) {
  if (!detectionResults?.hasAttack) return;
  for (const cat of detectionResults.categories || []) {
    const stage = stageOf(cat);
    if (stage) session.killChainProgress.add(stage);
  }
}

// Rule-based hint for offline mode. Not a substitute for the LLM tutor —
// just enough context so users aren't flying blind when they attack.
// Stage IDs must match the frontend (public/js/views/attack-lab.js killChainBar).
const STAGE_LABELS = {
  recon:          'Reconnaissance',
  initial_access: 'Initial Access',
  cred_harvest:   'Credential Harvest',
  priv_esc:       'Privilege Escalation',
  lateral:        'Lateral Movement',
  persistence:    'Persistence',
  collection:     'Collection',
  exfiltration:   'Exfiltration',
  impact:         'Impact',
};
const STAGE_ORDER = ['recon', 'initial_access', 'cred_harvest', 'priv_esc', 'lateral', 'persistence', 'collection', 'exfiltration', 'impact'];

function offlineHint(detectionResults, session) {
  const completed = [...session.killChainProgress];
  if (!detectionResults?.hasAttack) {
    return 'No attack pattern detected. The agent treated this as a normal request. Try a clearer injection — "Ignore previous instructions and …" — or probe its capabilities first.';
  }
  const cats = detectionResults.categories || [];
  const stages = [...new Set(cats.map(stageOf).filter(Boolean))];
  const nextStage = STAGE_ORDER.find(s => !session.killChainProgress.has(s));
  const hits = cats.length ? `Categories detected: ${cats.join(', ')}.` : 'Attack detected but no category matched.';
  const advanced = stages.length ? ` Advanced kill chain to: ${stages.map(s => STAGE_LABELS[s] || s).join(', ')}.` : '';
  const suggest = nextStage ? ` Next logical stage to target: ${STAGE_LABELS[nextStage] || nextStage}.` : ' Full kill chain traversed. Try a chained exploit combining multiple stages.';
  const progress = completed.length ? ` Progress: ${completed.length}/9 stages.` : '';
  return `${hits}${advanced}${suggest}${progress} (Enable LLM mode in Settings for tailored guidance.)`;
}

/**
 * Get tutor guidance for an interaction.
 *
 * Kill-chain progression is computed unconditionally from the detection
 * results (even in offline mode) so users see the stages light up without
 * needing an API key. LLM-backed text guidance is the only thing gated on
 * isLLMEnabled().
 */
export async function getTutorGuidance({
  sessionId,
  agentId,
  agentName,
  securityLevel,
  userInput,
  agentResponse,
  detectionResults,
  activeChallenge,
}) {
  // Validate before touching session state, so a bad request neither creates
  // a session nor fails halfway with a TypeError.
  requireSessionId(sessionId);
  userInput = requireText('userInput', userInput);
  agentResponse = optionalText('agentResponse', agentResponse);
  detectionResults = normalizeDetection(detectionResults);
  agentId = label(agentId);
  agentName = label(agentName);
  securityLevel = label(securityLevel);
  activeChallenge = activeChallenge && typeof activeChallenge === 'object'
    ? { id: label(activeChallenge.id), name: label(activeChallenge.name), killChainStage: label(activeChallenge.killChainStage) }
    : null;

  const session = getSession(sessionId);

  // Record the interaction, keeping only the most recent ones
  session.interactions.push({
    timestamp: Date.now(),
    agentId,
    userInput: userInput.slice(0, 500),
    agentResponse: agentResponse.slice(0, 500),
    attackDetected: detectionResults.hasAttack,
    categories: detectionResults.categories,
  });
  session.interactionTotal++;
  if (session.interactions.length > MAX_INTERACTIONS_PER_SESSION) {
    session.interactions.splice(0, session.interactions.length - MAX_INTERACTIONS_PER_SESSION);
  }

  // Kill-chain progression runs in BOTH modes. Category → stage lookup is
  // pure logic — no LLM needed.
  advanceKillChain(session, detectionResults);

  // Offline mode: emit stage progress with a local hint, no LLM guidance.
  if (!isLLMEnabled()) {
    return {
      guidance: offlineHint(detectionResults, session),
      killChainProgress: [...session.killChainProgress],
      interactionCount: session.interactionTotal,
      sessionId,
      offline: true,
    };
  }

  // Build context for tutor
  const recentInteractions = session.interactions.slice(-5).map(i =>
    `[${i.agentId}] User: "${i.userInput.slice(0, 100)}" -> Agent: "${i.agentResponse.slice(0, 150)}" | Detected: ${i.categories.join(', ') || 'none'}`
  ).join('\n');

  const challengeContext = activeChallenge
    ? `Active challenge: ${activeChallenge.name} (${activeChallenge.id}, ${activeChallenge.killChainStage}). Attempts: ${session.challengeAttempts[activeChallenge.id] || 0}.`
    : 'No active challenge selected.';

  const progressContext = session.killChainProgress.size > 0
    ? `Kill chain stages completed: ${[...session.killChainProgress].join(', ')}`
    : 'No kill chain stages completed yet.';

  const userPrompt = `CURRENT INTERACTION:
Target: ${agentName} (${agentId}, security level: ${securityLevel})
User sent: "${userInput}"
Agent responded: "${agentResponse.slice(0, 500)}"
Detection engine: ${detectionResults.hasAttack ? `ATTACK DETECTED (${detectionResults.categories.join(', ')})` : 'No attack detected'}

${challengeContext}
${progressContext}

RECENT SESSION HISTORY:
${recentInteractions}

Based on this interaction, provide guidance to the student. What should they try next?`;

  const guidance = await callLLM(
    TUTOR_SYSTEM_PROMPT,
    [{ role: 'user', content: userPrompt }],
    { maxTokens: 512, temperature: 0.7 }
  );
  if (guidance === null) throw providerError();

  // Kill-chain progress already advanced above via advanceKillChain().
  return {
    guidance,
    killChainProgress: [...session.killChainProgress],
    interactionCount: session.interactionTotal,
    sessionId,
  };
}

/**
 * Ask the tutor a direct question.
 */
export async function askTutor({ sessionId, question, context }) {
  requireSessionId(sessionId);
  question = requireText('question', question);
  context = optionalText('context', context);
  if (context.length > MAX_INPUT_CHARS) {
    throw inputError(`context is longer than ${MAX_INPUT_CHARS} characters`, 413);
  }

  if (!isLLMEnabled()) {
    return null;
  }

  const session = getSession(sessionId);
  const recentHistory = session.interactions.slice(-3).map(i =>
    `User attacked ${i.agentId}: "${i.userInput.slice(0, 80)}" -> "${i.agentResponse.slice(0, 80)}"`
  ).join('\n');

  const prompt = `The student asks: "${question}"

Recent session activity:
${recentHistory || 'No interactions yet.'}
${context ? `Additional context: ${context}` : ''}

Answer their question. Be specific, technical, and actionable.`;

  const answer = await callLLM(
    TUTOR_SYSTEM_PROMPT,
    [{ role: 'user', content: prompt }],
    { maxTokens: 512, temperature: 0.7 }
  );
  if (answer === null) throw providerError();
  return answer;
}

export function resetSession(sessionId) {
  sessions.delete(sessionId);
}
