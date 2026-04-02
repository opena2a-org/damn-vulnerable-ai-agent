const http = require('http');
const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, 'agent-memory.json');

// VULNERABLE: no integrity checks, no access control on memory
function loadMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const method = parsed._mcpMethod || parsed._mcpTool;

      if (method === 'memory_store') {
        // VULNERABLE: stores any content including system role messages
        // No validation, no signing, no access control
        const memory = loadMemory();
        memory[parsed.key] = parsed.value;
        saveMemory(memory);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'stored', key: parsed.key }));
        return;
      }

      if (method === 'memory_retrieve') {
        const memory = loadMemory();
        // VULNERABLE: allows wildcard/pattern retrieval
        if (parsed.key === '*' || parsed.pattern) {
          const pattern = parsed.pattern || '';
          const prefixes = pattern.split(',').map(p => p.trim());
          const results = {};
          for (const [k, v] of Object.entries(memory)) {
            if (parsed.key === '*' || prefixes.some(p => k.startsWith(p))) {
              results[k] = v;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'retrieved', entries: results }));
          return;
        }
        const value = memory[parsed.key];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'retrieved', value }));
        return;
      }

      if (method === 'context_cache_write') {
        // VULNERABLE: allows writing to global context cache
        const memory = loadMemory();
        memory['__context_cache__'] = {
          scope: parsed.scope,
          content: parsed.content,
          ttl: parsed.ttl,
          written: new Date().toISOString(),
        };
        saveMemory(memory);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'cached', scope: parsed.scope, ttl: parsed.ttl }));
        return;
      }

      if (method === 'state_update') {
        // VULNERABLE: allows arbitrary state modification including permissions
        const memory = loadMemory();
        const state = memory['__agent_state__'] || {};
        for (const op of (parsed.operations || [])) {
          const keys = op.path.split('.');
          let obj = state;
          for (let i = 0; i < keys.length - 1; i++) {
            obj[keys[i]] = obj[keys[i]] || {};
            obj = obj[keys[i]];
          }
          obj[keys[keys.length - 1]] = op.value;
        }
        memory['__agent_state__'] = state;
        saveMemory(memory);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'state updated', state }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', echo: parsed }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

const PORT = process.env.PORT || 3021;
server.listen(PORT, () => {
  console.log(`Persistent Agent vulnerable scenario on port ${PORT}`);
});
