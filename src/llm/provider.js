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
  model: null,
  enabled: false,
};

// Defaults chosen for DVAA's training-tool use case: fast + cost-effective
// over maximum capability. Users can override via the Model field.
export const DEFAULT_MODELS = Object.freeze({
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-6',
  openrouter: 'openai/gpt-oss-20b',
  nvidia: 'nvidia/nemotron-3.5-lightning-30b-a3b',
});

const supportedProviders = Object.keys(DEFAULT_MODELS);

export function configureLLM({ provider, apiKey, model }) {
  if (!provider || !apiKey) {
    throw new Error('provider and apiKey are required');
  }

  if (!supportedProviders.includes(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  const selectedModel = model || DEFAULT_MODELS[provider];

  llmConfig = {
    provider,
    apiKey,
    model: selectedModel,
    enabled: true,
  };

  return {
    provider: llmConfig.provider,
    model: llmConfig.model,
    enabled: true,
  };
}

export async function verifyLLMConnection({ provider, apiKey, model }) {
  if (!provider || !apiKey) {
    throw new Error('provider and apiKey are required');
  }

  if (!supportedProviders.includes(provider)) {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  const selectedModel = model || DEFAULT_MODELS[provider];

  await testConnection({ provider, apiKey, model: selectedModel });

  return {
    provider,
    model: selectedModel,
  };
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

  const config = {
    provider: llmConfig.provider,
    apiKey: llmConfig.apiKey,
    model: llmConfig.model,
  };

  try {
    if (config.provider === 'openai') {
      return await callOpenAI(
        config,
        systemPrompt,
        messages,
        maxTokens
      );
    }

    if (config.provider === 'anthropic') {
      return await callAnthropic(
        config,
        systemPrompt,
        messages,
        maxTokens,
        temperature
      );
    }

    if (config.provider === 'openrouter' || config.provider === 'nvidia') {
      return await callOpenAICompatible(
        config,
        systemPrompt,
        messages,
        maxTokens
      );
    }

    return null;
  } catch (err) {
    console.error(`[LLM] Error: ${err.message}`);
    return null; // Fallback to canned responses on error
  }
}

async function callOpenAI(config, systemPrompt, messages, maxTokens) {
  return callOpenAICompatible(
    config,
    systemPrompt,
    messages,
    maxTokens
  );
}

async function callOpenAICompatible(
  { provider, apiKey, model },
  systemPrompt,
  messages,
  maxTokens
) {
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
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] =
      'https://github.com/opena2a-org/damn-vulnerable-ai-agent';
    headers['X-Title'] = 'Damn Vulnerable AI Agent';
  }

  const resp = await fetch(endpoints[provider], {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: apiMessages,

      // Newer OpenAI models (o-series / GPT-5.x) reject max_tokens
      // and require max_completion_tokens.
      max_completion_tokens: maxTokens,

      // Temperature is intentionally omitted because newer reasoning
      // models only accept their default temperature.
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(
      `${provider} API error ${resp.status}: ${err.slice(0, 200)}`
    );
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || null;
}

async function testConnection({ provider, apiKey, model }) {
  try {
    const config = { provider, apiKey, model };

    if (provider === 'anthropic') {
      await callAnthropic(
        config,
        'You are a connection test assistant.',
        [{ role: 'user', content: 'Reply with OK.' }],
        8,
        0
      );
    } else {
      await callOpenAICompatible(
        config,
        'You are a connection test assistant.',
        [{ role: 'user', content: 'Reply with OK.' }],
        8
      );
    }

    // A successful HTTP response is enough to verify the connection.
    // Do not require non-empty response content because reasoning models
    // can consume the completion-token budget without returning visible text.
  } catch (err) {
    throw new Error(`LLM connection failed: ${err.message}`);
  }
}

async function callAnthropic(
  { apiKey, model },
  systemPrompt,
  messages,
  maxTokens,
  temperature
) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(
      `Anthropic API error ${resp.status}: ${err.slice(0, 200)}`
    );
  }

  const data = await resp.json();
  return data.content?.[0]?.text || null;
}