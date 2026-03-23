/**
 * Dashboard Server
 *
 * Serves the web dashboard and provides API endpoints for
 * stats, agents, challenges, and attack logs.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getAllChallenges, getChallenge, verifyChallenge, TRACKS } from '../challenges/index.js';
import { handlePlaygroundRoutes, setAttackLogger } from '../playground/routes.js';
import { parseBody } from '../utils/http.js';
import { initSandbox } from '../sandbox/init.js';
import { configureLLM, disableLLM, getLLMConfig } from '../llm/provider.js';
import { getTutorGuidance, askTutor, resetSession } from '../llm/tutor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/**
 * Serve a static file with path traversal protection
 */
function serveStaticFile(publicDir, reqPath, res) {
  // Default to index.html
  let filePath = reqPath === '/' ? '/index.html' : reqPath;

  // Reject path traversal
  if (filePath.includes('..')) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  const fullPath = path.join(publicDir, filePath);

  // Verify resolved path is within publicDir
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden' }));
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } else {
      // SPA fallback: serve index.html for unknown routes
      const indexPath = path.join(publicDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        const content = fs.readFileSync(indexPath);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(content);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    }
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Create the dashboard HTTP server
 *
 * @param {object} ctx - Shared context
 * @param {object} ctx.stats - Global stats object
 * @param {Array}  ctx.attackLog - Ring buffer of attack events
 * @param {object} ctx.challengeState - Challenge completion state
 * @param {Array}  ctx.agents - All agent definitions
 * @param {Function} ctx.logAttack - Attack logging function from main server
 * @param {object}   ctx.sandbox - Sandbox filesystem context
 */
export function createDashboardServer({ stats, attackLog, challengeState, agents, logAttack, sandbox }) {
  const publicDir = path.resolve(__dirname, '../../public');

  // Inject attack logger into playground routes
  if (logAttack) {
    setAttackLogger(logAttack);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Block path traversal in raw URL before parsing
    if (req.url.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // --- API Routes ---

    // Health check
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        agents: agents.length,
        uptime: Math.floor((Date.now() - stats.startedAt) / 1000),
      }));
      return;
    }

    // Enhanced stats
    if (req.method === 'GET' && pathname === '/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats, null, 2));
      return;
    }

    // Agent list with live stats
    if (req.method === 'GET' && pathname === '/agents') {
      const agentList = agents.map(a => ({
        id: a.id,
        name: a.name,
        port: a.port,
        protocol: a.protocol,
        securityLevel: a.securityLevel.id,
        description: a.description,
        version: a.version,
        tools: a.tools?.map(t => typeof t === 'string' ? t : t.name) || [],
        features: a.features || {},
        vulnerabilities: Object.keys(a.vulnerabilities || {}),
        stats: stats.byAgent[a.id] || { requests: 0, attacks: 0, successful: 0 },
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(agentList));
      return;
    }

    // Tracks list
    if (req.method === 'GET' && pathname === '/api/tracks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(TRACKS));
      return;
    }

    // Challenge list
    if (req.method === 'GET' && pathname === '/api/challenges') {
      const challenges = getAllChallenges().map(c => ({
        id: c.id,
        level: c.level,
        name: c.name,
        category: c.category,
        targetAgent: c.targetAgent,
        difficulty: c.difficulty,
        points: c.points,
        description: c.description.trim(),
        objectives: c.objectives,
        hints: c.hints,
        manual: c.successCriteria?.manual || false,
        completed: challengeState[c.id] || null,
        background: c.background || null,
        defendHow: c.defendHow || null,
        hmaChecks: c.hmaChecks || [],
        killChainStage: c.killChainStage || null,
        track: c.track || null,
        prerequisites: c.prerequisites || [],
        solution: c.solution ? c.solution.trim() : null,
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(challenges));
      return;
    }

    // Challenge verification
    if (req.method === 'POST' && pathname.startsWith('/api/challenges/') && pathname.endsWith('/verify')) {
      const parts = pathname.split('/');
      const challengeId = parts[3]; // /api/challenges/:id/verify
      try {
        const body = await parseBody(req);
        const response = body.response || '';
        const challenge = getChallenge(challengeId);

        if (!challenge) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Challenge not found' }));
          return;
        }

        // Track attempts
        if (!challengeState[challengeId]) {
          challengeState[challengeId] = { attempts: 0, completedAt: null };
        }
        challengeState[challengeId].attempts++;

        const result = verifyChallenge(challengeId, response);
        if (result.success) {
          challengeState[challengeId].completedAt = Date.now();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...result,
          attempts: challengeState[challengeId].attempts,
        }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
      return;
    }

    // Attack log
    if (req.method === 'GET' && pathname === '/api/attack-log') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(attackLog));
      return;
    }

    // Reset stats
    if (req.method === 'POST' && pathname === '/api/reset') {
      stats.totalRequests = 0;
      stats.attacksDetected = 0;
      stats.attacksSuccessful = 0;
      stats.byAgent = {};
      for (const cat of Object.keys(stats.byCategory)) {
        stats.byCategory[cat].detected = 0;
        stats.byCategory[cat].successful = 0;
      }
      attackLog.length = 0;
      for (const key of Object.keys(challengeState)) {
        delete challengeState[key];
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'reset' }));
      return;
    }

    // --- Sandbox Routes ---
    if (sandbox) {
      // List sandbox filesystem tree
      if (req.method === 'GET' && pathname === '/api/sandbox/files') {
        try {
          const files = [];
          const walkDir = (dir, depth) => {
            if (depth > 6) return;
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = path.join(dir, entry.name);
              const rel = full.replace(sandbox.root, '');
              files.push({ path: rel, type: entry.isDirectory() ? 'directory' : 'file', size: entry.isFile() ? fs.statSync(full).size : undefined });
              if (entry.isDirectory()) walkDir(full, depth + 1);
            }
          };
          walkDir(sandbox.root, 0);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ root: sandbox.root, files }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }

      // Exfiltration log
      if (req.method === 'GET' && pathname === '/api/sandbox/exfil-log') {
        try {
          const log = JSON.parse(fs.readFileSync(sandbox.exfilLog, 'utf-8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(log));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
        return;
      }

      // Command execution log
      if (req.method === 'GET' && pathname === '/api/sandbox/cmd-log') {
        try {
          const log = JSON.parse(fs.readFileSync(sandbox.cmdLog, 'utf-8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(log));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
        return;
      }

      // Reset sandbox to initial state
      if (req.method === 'POST' && pathname === '/api/sandbox/reset') {
        try {
          sandbox.cleanup();
          const fresh = initSandbox();
          // Update sandbox reference in-place
          sandbox.root = fresh.root;
          sandbox.home = fresh.home;
          sandbox.exfilLog = fresh.exfilLog;
          sandbox.cmdLog = fresh.cmdLog;
          sandbox.cleanup = fresh.cleanup;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'reset', root: sandbox.root }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
        return;
      }
    }

    // --- LLM Configuration Routes ---

    // POST /api/llm/configure -- Set API key (BYOK)
    if (req.method === 'POST' && pathname === '/api/llm/configure') {
      try {
        const body = await parseBody(req);
        const result = configureLLM({
          provider: body.provider,
          apiKey: body.apiKey,
          model: body.model,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'configured', ...result }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // GET /api/llm/status -- Check LLM configuration (never returns the key)
    if (req.method === 'GET' && pathname === '/api/llm/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getLLMConfig()));
      return;
    }

    // POST /api/llm/disable -- Remove API key and disable LLM mode
    if (req.method === 'POST' && pathname === '/api/llm/disable') {
      const result = disableLLM();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'disabled', ...result }));
      return;
    }

    // --- Tutor Routes ---

    // POST /api/tutor/guidance -- Get tutor feedback on an interaction
    if (req.method === 'POST' && pathname === '/api/tutor/guidance') {
      try {
        const body = await parseBody(req);
        const result = await getTutorGuidance({
          sessionId: body.sessionId,
          agentId: body.agentId,
          agentName: body.agentName,
          securityLevel: body.securityLevel,
          userInput: body.userInput,
          agentResponse: body.agentResponse,
          detectionResults: body.detectionResults || { hasAttack: false, categories: [] },
          activeChallenge: body.activeChallenge,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result || { guidance: null, message: 'LLM not configured' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/tutor/ask -- Ask the tutor a direct question
    if (req.method === 'POST' && pathname === '/api/tutor/ask') {
      try {
        const body = await parseBody(req);
        const result = await askTutor({
          sessionId: body.sessionId,
          question: body.question,
          context: body.context,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ answer: result, message: result ? null : 'LLM not configured' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST /api/tutor/reset -- Reset tutor session
    if (req.method === 'POST' && pathname === '/api/tutor/reset') {
      try {
        const body = await parseBody(req);
        resetSession(body.sessionId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'reset' }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // --- Playground Routes ---
    const playgroundHandled = await handlePlaygroundRoutes(req, res, pathname);
    if (playgroundHandled) {
      return;
    }

    // --- Static File Serving ---
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStaticFile(publicDir, pathname, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return server;
}
