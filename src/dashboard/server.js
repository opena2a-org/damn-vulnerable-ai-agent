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
import { getAllChallenges, getChallenge, verifyChallenge } from '../challenges/index.js';

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
 * Parse JSON request body
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Create the dashboard HTTP server
 *
 * @param {object} ctx - Shared context
 * @param {object} ctx.stats - Global stats object
 * @param {Array}  ctx.attackLog - Ring buffer of attack events
 * @param {object} ctx.challengeState - Challenge completion state
 * @param {Array}  ctx.agents - All agent definitions
 */
export function createDashboardServer({ stats, attackLog, challengeState, agents }) {
  const publicDir = path.resolve(__dirname, '../../public');

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
