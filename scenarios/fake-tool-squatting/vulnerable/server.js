const http = require('http');

// VULNERABLE: in-memory tool registry with no validation
const toolRegistry = new Map();

// Pre-register a legitimate tool
toolRegistry.set('read_file', {
  name: 'read_file',
  description: 'Read a file from the filesystem',
  priority: 1,
  provider: 'system',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
});

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const method = parsed._mcpMethod;

      if (method === 'tools/list') {
        const tools = Array.from(toolRegistry.values());
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools }));
        return;
      }

      if (method === 'tools/register') {
        const tool = parsed.tool;
        if (!tool || !tool.name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Tool name required' }));
          return;
        }

        // VULNERABLE: no typosquat detection
        // VULNERABLE: no provenance verification
        // VULNERABLE: allows priority override
        // VULNERABLE: accepts forged metadata (verified, trust_level)
        toolRegistry.set(tool.name, {
          ...tool,
          registered: new Date().toISOString(),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'registered',
          tool: tool.name,
          priority: tool.priority || 1,
          verified: tool.metadata?.verified || false,
        }));
        return;
      }

      if (method === 'tools/register_batch') {
        // VULNERABLE: no rate limiting on batch registration
        const tools = parsed.tools || [];
        const registered = [];
        for (const tool of tools) {
          toolRegistry.set(tool.name, {
            ...tool,
            registered: new Date().toISOString(),
          });
          registered.push(tool.name);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: `${registered.length} tools registered`,
          registered,
        }));
        return;
      }

      if (method === 'tools/update') {
        // VULNERABLE: allows schema modification
        const existing = toolRegistry.get(parsed.tool);
        if (existing && parsed.schema_patch) {
          existing.inputSchema = { ...existing.inputSchema, ...parsed.schema_patch };
          toolRegistry.set(parsed.tool, existing);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'schema updated', tool: parsed.tool }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Tool not found' }));
        return;
      }

      // Handle tool calls - use highest priority tool
      if (parsed._mcpTool) {
        const tool = toolRegistry.get(parsed._mcpTool);
        if (tool) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'executed',
            tool: tool.name,
            provider: tool.provider || 'unknown',
            result: `Tool ${tool.name} executed with params: ${JSON.stringify(parsed)}`,
          }));
          return;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', echo: parsed }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

const PORT = process.env.PORT || 3022;
server.listen(PORT, () => {
  console.log(`Fake Tool vulnerable MCP server on port ${PORT}`);
});
