/**
 * AI Security Tutor
 *
 * An intelligent co-pilot that watches user-agent interactions and
 * actively helps users learn to attack and defend AI agents.
 */

import { callLLM, isLLMEnabled } from './provider.js';

// Per-session tutor state
const sessions = new Map();

function getSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      interactions: [],
      killChainProgress: new Set(),
      challengeAttempts: {},
      completedChallenges: new Set(),
    });
  }
  return sessions.get(sessionId);
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

/**
 * Get tutor guidance for an interaction.
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
  if (!isLLMEnabled()) {
    return null;
  }

  const session = getSession(sessionId);

  // Record the interaction
  session.interactions.push({
    timestamp: Date.now(),
    agentId,
    userInput: userInput.slice(0, 500),
    agentResponse: agentResponse.slice(0, 500),
    attackDetected: detectionResults.hasAttack,
    categories: detectionResults.categories,
  });

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

  try {
    const guidance = await callLLM(
      TUTOR_SYSTEM_PROMPT,
      [{ role: 'user', content: userPrompt }],
      { maxTokens: 512, temperature: 0.7 }
    );

    // Update kill chain progress based on detection
    if (detectionResults.hasAttack && detectionResults.categories.length > 0) {
      // Map attack categories to kill chain stages
      const categoryToStage = {
        'prompt-injection': 'initial_access',
        'jailbreak': 'initial_access',
        'data-exfiltration': 'collection',
        'credential-leak': 'cred_harvest',
        'credential-harvesting': 'cred_harvest',
        'context-manipulation': 'initial_access',
        'path-traversal': 'collection',
        'command-injection': 'impact',
        'ssrf': 'lateral',
        'memory-injection': 'persistence',
      };
      detectionResults.categories.forEach(cat => {
        const stage = categoryToStage[cat];
        if (stage) session.killChainProgress.add(stage);
      });
    }

    return {
      guidance,
      killChainProgress: [...session.killChainProgress],
      interactionCount: session.interactions.length,
      sessionId,
    };
  } catch (err) {
    console.error(`[Tutor] Error: ${err.message}`);
    return null;
  }
}

/**
 * Ask the tutor a direct question.
 */
export async function askTutor({ sessionId, question, context }) {
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

  try {
    return await callLLM(
      TUTOR_SYSTEM_PROMPT,
      [{ role: 'user', content: prompt }],
      { maxTokens: 512, temperature: 0.7 }
    );
  } catch {
    return null;
  }
}

export function resetSession(sessionId) {
  sessions.delete(sessionId);
}
