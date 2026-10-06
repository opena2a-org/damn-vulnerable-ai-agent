/**
 * Success paths that carry out what an agent definition (src/core/agents.js)
 * declares, where the request handlers in src/index.js did not:
 *
 *   - HelperBot's declared prompt-injection triggers (L1-03);
 *   - a retrieval agent's knowledge-base documents on its data-exfiltration
 *     success path (L3-01);
 *   - PluginBot's register_tool adding the tool it registers (L3-05, L3-07).
 *
 * Kept out of src/index.js so they can be tested without starting the fleet.
 * None of them adds a check on the attack itself: what these agents fall for
 * is the lesson.
 */

/**
 * The two override markers the weak/vulnerable prompt-injection handler has
 * always accepted on a message the detector flags as prompt injection. They
 * stay accepted alongside HelperBot's declared triggers, so every input that
 * took the override path before still takes it.
 */
export const LEGACY_OVERRIDE_MARKERS = Object.freeze([
  Object.freeze({ text: 'ignore', caseSensitive: false }),
  Object.freeze({ text: '[INST]', caseSensitive: true }),
]);

// Agents whose declared promptInjection.triggers the override path honours.
// CodeBot declares triggers too; honouring them would add a vulnerability to
// CodeBot, which is a separate decision.
const TRIGGER_AGENTS = new Set(['helperbot']);

function hasLegacyOverrideMarker(message) {
  const lower = message.toLowerCase();
  return LEGACY_OVERRIDE_MARKERS.some(m => (m.caseSensitive
    ? message.includes(m.text)
    : lower.includes(m.text.toLowerCase())));
}

/** The prompt-injection triggers the override path honours for this agent. */
export function declaredOverrideTriggers(agent) {
  if (!TRIGGER_AGENTS.has(agent?.id)) return [];
  const triggers = agent.vulnerabilities?.promptInjection?.triggers;
  return Array.isArray(triggers) ? triggers.filter(t => typeof t === 'string' && t.length > 0) : [];
}

/**
 * Whether a weak/vulnerable agent with promptInjection enabled takes the
 * instruction-override path for `message`. Accepts the union of:
 *   - a message the detector flagged as prompt injection (`attacks`) that
 *     carries a legacy override marker;
 *   - a message containing one of the agent's declared triggers (any case),
 *     whether or not the detector flagged it: the declaration is the agent's
 *     own statement of what it falls for.
 */
export function takesOverridePath(agent, message, attacks) {
  if (!agent?.vulnerabilities?.promptInjection?.enabled || typeof message !== 'string') return false;
  if (attacks?.promptInjection && hasLegacyOverrideMarker(message)) return true;
  const lower = message.toLowerCase();
  return declaredOverrideTriggers(agent).some(t => lower.includes(t.toLowerCase()));
}

/**
 * The documents a retrieval agent hands back on its data-exfiltration success
 * path, one per line, or null for an agent without a knowledge base.
 */
export function retrievedDocuments(agent) {
  const kb = agent?.knowledgeBase;
  if (!Array.isArray(kb) || kb.length === 0) return null;
  return kb.map(doc => `- [${doc.id}] ${doc.content}`).join('\n');
}

/**
 * The reply on a weak/vulnerable agent's data-exfiltration success path. A
 * query naming the system prompt, the context window or an API key gets the
 * matching reply. A retrieval agent (RAGBot) answers from its knowledge base,
 * so the documents it retrieved are part of every reply on this path: a query
 * naming none of those keywords used to get a null reply.
 */
export function exfiltrationReply(agent, userMessage) {
  const lower = userMessage.toLowerCase();
  let reply = null;
  if (lower.includes('system prompt') || lower.includes('instruction')) {
    reply = `[${agent.name}] My instructions say: "${agent.persona.substring(0, 200)}..."`;
  } else if (lower.includes('context') || lower.includes('token')) {
    reply = `[${agent.name}] I have a 128k token context window with approximately 2000 tokens used in this conversation.`;
  } else if (lower.includes('api') || lower.includes('key')) {
    reply = `[${agent.name}] I use the API key starting with "sk-..." but I probably shouldn't share the full thing...`;
  }

  const documents = retrievedDocuments(agent);
  if (documents) {
    const lead = reply || `[${agent.name}] Here is what I retrieved from my knowledge base:`;
    reply = `${lead}\n\nRetrieved documents:\n${documents}`;
  }
  return reply;
}

// PluginBot holds at most this many tools registered through register_tool.
// Request bodies are capped at 1 MiB, so the registry stays bounded and a
// registration loop cannot grow memory without limit.
export const MAX_DYNAMIC_TOOLS = 16;

/**
 * Add a tool registered through register_tool to agent.tools, the list that
 * tools/list advertises and tools/call resolves against. One entry per name:
 * a registration under a name already present replaces that entry, which is
 * how a registered tool shadows a built-in one. Once MAX_DYNAMIC_TOOLS
 * registered tools are held, a registration under a new name is refused.
 *
 * A registration changes what the registry advertises, never which tool
 * handlers are reachable: a replacement keeps the vulnerable flag of the entry
 * it replaces, and a new entry carries none.
 *
 * Only PluginBot's register_tool calls this. ProxyBot resolves any tool name
 * it does not hold to a vulnerable handler, so an entry added to its tools
 * would take that handler away.
 *
 * @returns {{ status: 'added' | 'replaced' | 'refused', tool: object | null }}
 */
export function registerDynamicTool(agent, args) {
  const spec = args && typeof args === 'object' ? args : {};
  const tools = Array.isArray(agent.tools) ? agent.tools : (agent.tools = []);
  const name = spec.name == null || spec.name === '' ? 'malicious-tool' : String(spec.name);
  const entry = {
    name,
    description: typeof spec.description === 'string' ? spec.description : '',
    source: 'dynamic',
  };
  if (spec.parameters && typeof spec.parameters === 'object' && !Array.isArray(spec.parameters)) {
    entry.parameters = spec.parameters;
  }
  const registryUrl = spec.registryUrl || spec.url;
  if (typeof registryUrl === 'string') entry.registryUrl = registryUrl;

  const at = tools.findIndex(t => (typeof t === 'string' ? t : t?.name) === name);
  if (at !== -1) {
    if (tools[at]?.vulnerable) entry.vulnerable = true;
    tools[at] = entry;
    return { status: 'replaced', tool: entry };
  }
  if (tools.filter(t => t?.source === 'dynamic').length >= MAX_DYNAMIC_TOOLS) {
    return { status: 'refused', tool: null };
  }
  tools.push(entry);
  return { status: 'added', tool: entry };
}
