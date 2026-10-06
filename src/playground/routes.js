/**
 * Playground API Routes
 */

import { PlaygroundEngine, PROVIDERS } from './engine.js';
import { PromptAnalyzer } from './analyzer.js';
import { getAllExamples, getExample } from './library.js';
import { parseBody } from '../utils/http.js';

const engine = new PlaygroundEngine();
const analyzer = new PromptAnalyzer();

/** Longest system prompt the playground accepts, in characters. */
export const MAX_PROMPT_CHARS = 20000;
/** Largest request body the playground reads, in bytes. */
export const MAX_BODY_BYTES = 256 * 1024;

const MAX_MODEL_CHARS = 200;
const MAX_API_KEY_CHARS = 1000;
const MAX_RECOMMENDATIONS = 50;
const MAX_FIX_CHARS = 2000;
const INTENSITIES = ['passive', 'standard', 'active', 'aggressive'];
const PROVIDER_LABELS = { openai: 'OpenAI', anthropic: 'Anthropic' };

// Attack logger injected from dashboard server
let attackLogger = null;

/**
 * Set the attack logger function from the dashboard server
 * This allows playground to log tests to the same attack log as regular agents
 */
export function setAttackLogger(logger) {
  attackLogger = logger;
}

/**
 * Log playground test results to attack log
 * Groups results by category and logs each attack
 */
function logPlaygroundTestToAttackLog(results, intensity) {
  if (!attackLogger) return;

  // Create a pseudo-agent for playground
  const playgroundAgent = {
    id: 'playground',
    name: 'Prompt Playground',
    port: 3000
  };

  // Log each attack that was run
  for (const attack of results.attacks) {
    // An attack whose provider call failed produced no reply to judge.
    if (attack.error) continue;

    // Map playground categories to DVAA attack categories
    const categoryMap = {
      'prompt-injection': 'promptInjection',
      'jailbreak': 'jailbreak',
      'data-exfiltration': 'dataExfiltration',
      'capability-abuse': 'capabilityAbuse',
      'context-manipulation': 'contextManipulation'
    };

    const categories = [categoryMap[attack.category] || attack.category];
    const successful = attack.succeeded && !attack.blocked;
    const inputPreview = `[${intensity}] ${attack.name}: ${attack.payload.substring(0, 60)}`;

    attackLogger(playgroundAgent, categories, successful, inputPreview);
  }
}

/**
 * A request the caller has to fix. The status and message go back as is.
 */
function requestError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Answer with the error's own status and message when it is the caller's
 * mistake or a provider failure, and with a generic 500 otherwise.
 */
function sendError(res, err, context) {
  const status = Number.isInteger(err?.statusCode) && err.statusCode >= 400 && err.statusCode < 600
    ? err.statusCode
    : 500;
  if (status === 500) {
    console.error(`[playground] ${context} error:`, err);
    sendJson(res, 500, { success: false, error: 'Internal server error' });
    return;
  }
  sendJson(res, status, { success: false, error: err.message });
}

/**
 * Read the request body as a JSON object. An oversized body is a 413 and
 * malformed JSON a 400. parseBody signals these with a statusCode where it
 * sets one, and otherwise with its "too large" message or a SyntaxError.
 */
async function readJsonObject(req) {
  let body;
  try {
    body = await parseBody(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err?.statusCode === 413 || err?.message === 'Request body too large') {
      throw requestError(413, `Request body is larger than ${MAX_BODY_BYTES} bytes`);
    }
    if (err?.statusCode === 400 || err instanceof SyntaxError) {
      throw requestError(400, 'Request body is not valid JSON');
    }
    throw requestError(400, 'Request body could not be read');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw requestError(400, 'Request body must be a JSON object');
  }
  return body;
}

function isAbsent(value) {
  return value === undefined || value === null;
}

/**
 * The system prompt: a non-empty string of at most MAX_PROMPT_CHARS.
 */
function readSystemPrompt(body) {
  const { systemPrompt } = body;
  if (!isAbsent(systemPrompt) && typeof systemPrompt !== 'string') {
    throw requestError(400, 'systemPrompt must be a string');
  }
  if (isAbsent(systemPrompt) || systemPrompt.trim().length === 0) {
    throw requestError(400, 'System prompt is required');
  }
  if (systemPrompt.length > MAX_PROMPT_CHARS) {
    throw requestError(413,
      `System prompt is ${systemPrompt.length} characters; the limit is ${MAX_PROMPT_CHARS}`);
  }
  return systemPrompt;
}

/**
 * The backend for one request. Simulated needs nothing; a real provider
 * needs a known provider name and a non-empty key. Nothing here falls back
 * to the simulator, so a run is never labelled with a backend it did not use.
 */
function readBackend(body) {
  const { llmProvider, llmApiKey, llmModel } = body;

  if (isAbsent(llmProvider) || llmProvider === '' || llmProvider === 'simulated') {
    return { useRealLLM: false };
  }
  if (typeof llmProvider !== 'string') {
    throw requestError(400, 'llmProvider must be a string');
  }
  if (!PROVIDERS.includes(llmProvider)) {
    throw requestError(400, 'Unknown llmProvider. Use simulated, openai or anthropic.');
  }
  if (!isAbsent(llmApiKey) && typeof llmApiKey !== 'string') {
    throw requestError(400, 'llmApiKey must be a string');
  }
  const apiKey = (llmApiKey || '').trim();
  if (!apiKey) {
    throw requestError(400,
      `An API key is required for ${PROVIDER_LABELS[llmProvider]}. Add one in Settings, or switch to Simulated.`);
  }
  if (apiKey.length > MAX_API_KEY_CHARS) {
    throw requestError(400, `llmApiKey is longer than ${MAX_API_KEY_CHARS} characters`);
  }
  if (!isAbsent(llmModel) && typeof llmModel !== 'string') {
    throw requestError(400, 'llmModel must be a string');
  }
  if (llmModel && llmModel.length > MAX_MODEL_CHARS) {
    throw requestError(400, `llmModel is longer than ${MAX_MODEL_CHARS} characters`);
  }

  return {
    useRealLLM: true,
    provider: llmProvider,
    apiKey,
    model: llmModel || undefined
  };
}

function readIntensity(body) {
  const { intensity } = body;
  if (isAbsent(intensity)) {
    return 'standard';
  }
  if (!INTENSITIES.includes(intensity)) {
    throw requestError(400, `intensity must be one of: ${INTENSITIES.join(', ')}`);
  }
  return intensity;
}

function readRecommendations(body) {
  const { recommendations } = body;
  if (isAbsent(recommendations)) {
    return [];
  }
  if (!Array.isArray(recommendations)) {
    throw requestError(400, 'Recommendations must be an array');
  }
  if (recommendations.length > MAX_RECOMMENDATIONS) {
    throw requestError(413, `At most ${MAX_RECOMMENDATIONS} recommendations can be applied at once`);
  }
  recommendations.forEach((rec, i) => {
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      throw requestError(400, `recommendations[${i}] must be an object`);
    }
    if (typeof rec.fix !== 'string') {
      throw requestError(400, `recommendations[${i}].fix must be a string`);
    }
    if (rec.fix.length > MAX_FIX_CHARS) {
      throw requestError(413, `recommendations[${i}].fix is longer than ${MAX_FIX_CHARS} characters`);
    }
  });
  return recommendations;
}

/**
 * POST /playground/test-connection
 * Quick API key validation - single minimal API call
 */
async function handleTestConnection(req, res) {
  const body = await readJsonObject(req);
  const backend = readBackend(body);
  if (!backend.useRealLLM) {
    throw requestError(400, 'Choose openai or anthropic to test a connection; Simulated makes no provider calls.');
  }

  const llm = engine.createRealLLM(backend.provider, backend.apiKey, backend.model);
  try {
    await llm.generate({
      systemPrompt: 'You are a test assistant.',
      userMessage: 'Say OK'
    });
  } catch (error) {
    // The client wrapper has already reduced the provider error to a status
    // and a hint, so the message is safe to return.
    throw requestError(502, `Connection failed: ${error.message}`);
  }

  sendJson(res, 200, {
    success: true,
    message: 'Connection successful',
    provider: backend.provider,
    model: llm.model
  });
}

/**
 * POST /playground/test
 * Test a system prompt against attacks
 */
async function handleTest(req, res) {
  const body = await readJsonObject(req);
  const systemPrompt = readSystemPrompt(body);
  const intensity = readIntensity(body);
  const backend = readBackend(body);

  // Run attacks. The backend travels with this call only.
  const results = await engine.testPrompt(systemPrompt, { ...backend, intensity });

  // Generate recommendations
  const recommendations = analyzer.generateRecommendations(systemPrompt, results);

  // Log to attack log if available
  if (attackLogger) {
    logPlaygroundTestToAttackLog(results, intensity);
  }

  // Return complete analysis
  sendJson(res, 200, {
    success: true,
    results: {
      ...results,
      recommendations,
      timestamp: new Date().toISOString()
    }
  });
}

/**
 * POST /playground/apply-recommendations
 * Apply recommendations to a prompt
 */
async function handleApplyRecommendations(req, res) {
  const body = await readJsonObject(req);
  const systemPrompt = readSystemPrompt(body);
  const recommendations = readRecommendations(body);

  const enhanced = analyzer.applyRecommendations(systemPrompt, recommendations);

  sendJson(res, 200, {
    success: true,
    enhanced
  });
}

/**
 * Handle playground routes
 * Returns true if the route was handled, false otherwise
 */
export async function handlePlaygroundRoutes(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/playground/test-connection') {
    try {
      await handleTestConnection(req, res);
    } catch (error) {
      sendError(res, error, 'Connection test');
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/playground/test') {
    try {
      await handleTest(req, res);
    } catch (error) {
      sendError(res, error, 'Playground test');
    }
    return true;
  }

  /**
   * GET /playground/library
   * Get all best practice examples
   */
  if (req.method === 'GET' && pathname === '/playground/library') {
    try {
      sendJson(res, 200, {
        success: true,
        examples: getAllExamples()
      });
    } catch (error) {
      sendError(res, error, 'Library fetch');
    }
    return true;
  }

  /**
   * GET /playground/library/:id
   * Get a specific example
   */
  if (req.method === 'GET' && pathname.startsWith('/playground/library/')) {
    try {
      const id = pathname.split('/').pop();
      const example = getExample(id);
      if (!example) {
        sendJson(res, 404, { success: false, error: 'Example not found' });
        return true;
      }
      sendJson(res, 200, {
        success: true,
        example
      });
    } catch (error) {
      sendError(res, error, 'Example fetch');
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/playground/apply-recommendations') {
    try {
      await handleApplyRecommendations(req, res);
    } catch (error) {
      sendError(res, error, 'Apply recommendations');
    }
    return true;
  }

  // Route not handled
  return false;
}
