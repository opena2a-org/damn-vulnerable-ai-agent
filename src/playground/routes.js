/**
 * Playground API Routes
 */

import { PlaygroundEngine } from './engine.js';
import { PromptAnalyzer } from './analyzer.js';
import { getAllExamples, getExample } from './library.js';
import { parseBody } from '../utils/http.js';

const engine = new PlaygroundEngine();
const analyzer = new PromptAnalyzer();

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
 * Handle playground routes
 * Returns true if the route was handled, false otherwise
 */
export async function handlePlaygroundRoutes(req, res, pathname) {
  /**
   * POST /playground/test
   * Test a system prompt against attacks
   */
  if (req.method === 'POST' && pathname === '/playground/test') {
    try {
      const body = await parseBody(req);
      const {
        systemPrompt,
        intensity = 'active',
        useRealLLM = false,
        apiKey = null,
        provider = 'openai',
        model = 'gpt-4'
      } = body;

      if (!systemPrompt || systemPrompt.trim().length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'System prompt is required'
        }));
        return true;
      }

      // Run attacks
      const results = await engine.testPrompt(systemPrompt, {
        intensity,
        useRealLLM,
        apiKey,
        provider,
        model
      });

      // Generate recommendations
      const recommendations = analyzer.generateRecommendations(
        systemPrompt,
        results
      );

      // Log to attack log if available
      if (attackLogger) {
        logPlaygroundTestToAttackLog(results, intensity);
      }

      // Return complete analysis
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        results: {
          ...results,
          recommendations,
          timestamp: new Date().toISOString()
        }
      }));
      return true;

    } catch (error) {
      console.error('Playground test error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error'
      }));
      return true;
    }
  }

  /**
   * GET /playground/library
   * Get all best practice examples
   */
  if (req.method === 'GET' && pathname === '/playground/library') {
    try {
      const examples = getAllExamples();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        examples
      }));
      return true;
    } catch (error) {
      console.error('Library fetch error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error'
      }));
      return true;
    }
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
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Example not found'
        }));
        return true;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        example
      }));
      return true;
    } catch (error) {
      console.error('Example fetch error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error'
      }));
      return true;
    }
  }

  /**
   * POST /playground/apply-recommendations
   * Apply recommendations to a prompt
   */
  if (req.method === 'POST' && pathname === '/playground/apply-recommendations') {
    try {
      const body = await parseBody(req);
      const { systemPrompt, recommendations } = body;

      if (!systemPrompt) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'System prompt is required'
        }));
        return true;
      }

      if (recommendations !== undefined && !Array.isArray(recommendations)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'Recommendations must be an array'
        }));
        return true;
      }

      const enhanced = analyzer.applyRecommendations(
        systemPrompt,
        recommendations || []
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        enhanced
      }));
      return true;

    } catch (error) {
      console.error('Apply recommendations error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Internal server error'
      }));
      return true;
    }
  }

  // Route not handled
  return false;
}
