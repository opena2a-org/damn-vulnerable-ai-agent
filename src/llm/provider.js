/**
 * LLM Provider - Abstraction over OpenAI-compatible and Anthropic APIs
 *
 * Supports BYOK (Bring Your Own Key). The user's API key is stored
 * in memory only, never persisted to disk or sent to any server.
 */

// In-memory API key storage (never persisted)
let llmConfig = {
  provider: null,    // 'openai', 'anthropic', 'openrouter', or 'nvidia'
  apiKey: null,
  model: null,       // e.g. 'gpt-4o-mini', 'claude-sonnet-4-6'
  enabled: false,
};

export function configureLLM({ provider, apiKey, model }) {
  if (!provider || !apiKey) {
    throw new Error('provider and apiKey are required');
  }

  const supportedProviders = ['openai', 'anthropic', 'openrouter', 'nvidia'];
  if (!supportedProviders.includes(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  // Defaults chosen for DVAA's training-tool use case: fast + cost-effective
  // over maximum capability. Users can override via the Model field.
  const defaults = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-6',
    openrouter: 'openai/gpt-oss-20b:free',
    nvidia: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  };

  const selectedModel = model || defaults[provider];

  llmConfig = {
    provider,
    apiKey,
    model: selectedModel || 'gpt-4o-mini',
    enabled: true,
  };

  return { provider: llmConfig.provider, model: llmConfig.model, enabled: true };
}

export async function verifyLLMConnection({ provider, apiKey, model }) {
  const defaults = {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-sonnet-4-6',
    openrouter: 'openai/gpt-oss-20b:free',
    nvidia: 'nvidia/nemotron-3.5-lightning-30b-a3b',
  };
  if (!provider || !apiKey) {
    throw new Error('provider and apiKey are required');
  }
  const supportedProviders = ['openai', 'anthropic', 'openrouter', 'nvidia'];
  if (!supportedProviders.includes(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
  await testConnection(provider, apiKey, model || defaults[provider]);
  return { provider, model: model || defaults[provider] };
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
      return await callOpenAI(systemPrompt, messages, maxTokens);
    } else if (llmConfig.provider === 'anthropic') {
      return await callAnthropic(systemPrompt, messages, maxTokens, temperature);
    } else if (llmConfig.provider === 'openrouter' || llmConfig.provider === 'nvidia') {
      return await callOpenAICompatible(llmConfig.provider, systemPrompt, messages, maxTokens);
    }
    return null;
  } catch (err) {
    console.error(`[LLM] Error: ${err.message}`);
    return null; // Fallback to canned responses on error
  }
}

async function callOpenAI(systemPrompt, messages, maxTokens) {
  return callOpenAICompatible('openai', systemPrompt, messages, maxTokens);
}

async function callOpenAICompatible(provider, systemPrompt, messages, maxTokens) {
  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const endpoints = {
    openai: 'https://api.openai.com/v1/chat/completions',
    openrouter: 'https://openrouter.ai/api/v1/chat/completions',
    nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  };
  const headers = {
    'Authorization': `Bearer ${llmConfig.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/opena2a-org/damn-vulnerable-ai-agent';
    headers['X-Title'] = 'Damn Vulnerable AI Agent';
  }

  const resp = await fetch(endpoints[provider], {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: llmConfig.model,
      messages: apiMessages,
      // Newer OpenAI models (o-series / GPT-5.x) reject max_tokens and require
      // max_completion_tokens. Older models accept both, so this works everywhere.
      max_completion_tokens: maxTokens,
      // temperature is intentionally omitted: o-series / GPT-5.x reasoning
      // models only accept the default (1) and 400 on any explicit value;
      // older models accept the default too, so omitting it works on every
      // OpenAI model without maintaining a model-family allowlist.
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${provider} API error ${resp.status}: ${err.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || null;
}

async function testConnection(provider, apiKey, model) {
  const previousConfig = llmConfig;
  llmConfig = { provider, apiKey, model, enabled: false };
  try {
    const response = provider === 'anthropic'
      ? await callAnthropic('You are a connection test assistant.', [{ role: 'user', content: 'Reply with OK.' }], 8, 0)
      : await callOpenAICompatible(provider, 'You are a connection test assistant.', [{ role: 'user', content: 'Reply with OK.' }], 8);
    if (!response) throw new Error('The provider returned an empty response');
  } catch (err) {
    throw new Error(`LLM connection failed: ${err.message}`);
  } finally {
    llmConfig = previousConfig;
  }
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
