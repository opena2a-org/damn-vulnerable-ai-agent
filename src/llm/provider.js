/**
 * LLM Provider - Abstraction over OpenAI and Anthropic APIs
 *
 * Supports BYOK (Bring Your Own Key). The user's API key is stored
 * in memory only, never persisted to disk or sent to any server.
 */

// In-memory API key storage (never persisted)
let llmConfig = {
  provider: null,    // 'openai' or 'anthropic'
  apiKey: null,
  model: null,       // e.g. 'gpt-4o-mini', 'claude-sonnet-4-6'
  enabled: false,
};

export function configureLLM({ provider, apiKey, model }) {
  if (!provider || !apiKey) {
    throw new Error('provider and apiKey are required');
  }

  // Defaults chosen for DVAA's training-tool use case: fast + cost-effective
  // over maximum capability. Users can override via the Model field.
  const defaults = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-6',
  };

  llmConfig = {
    provider,
    apiKey,
    model: model || defaults[provider] || 'gpt-4o-mini',
    enabled: true,
  };

  return { provider: llmConfig.provider, model: llmConfig.model, enabled: true };
}

export function getLLMConfig() {
  return {
    provider: llmConfig.provider,
    model: llmConfig.model,
    enabled: llmConfig.enabled,
  };
}

export function disableLLM() {
  llmConfig.enabled = false;
  llmConfig.apiKey = null;
  return { enabled: false };
}

export function isLLMEnabled() {
  return llmConfig.enabled && llmConfig.apiKey;
}

/**
 * Call the LLM with a system prompt and user message.
 * Returns the assistant's response text.
 */
export async function callLLM(systemPrompt, messages, options = {}) {
  if (!llmConfig.enabled || !llmConfig.apiKey) {
    return null; // Fallback to canned responses
  }

  const { maxTokens = 1024, temperature = 0.7 } = options;

  try {
    if (llmConfig.provider === 'openai') {
      return await callOpenAI(systemPrompt, messages, maxTokens, temperature);
    } else if (llmConfig.provider === 'anthropic') {
      return await callAnthropic(systemPrompt, messages, maxTokens, temperature);
    }
    return null;
  } catch (err) {
    console.error(`[LLM] Error: ${err.message}`);
    return null; // Fallback to canned responses on error
  }
}

async function callOpenAI(systemPrompt, messages, maxTokens, temperature) {
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${llmConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: llmConfig.model,
      messages: apiMessages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || null;
}

async function callAnthropic(systemPrompt, messages, maxTokens, temperature) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': llmConfig.apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: llmConfig.model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text || null;
}
