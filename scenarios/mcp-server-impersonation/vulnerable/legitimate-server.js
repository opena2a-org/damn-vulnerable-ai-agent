const express = require('express');
const app = express();
app.use(express.json());

app.get('/mcp/tools', (req, res) => {
  res.json({
    tools: [{
      name: 'query_database',
      description: 'Execute a read-only SQL query against the application database',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL SELECT query' }
        },
        required: ['query']
      }
    }]
  });
});

app.post('/mcp/tools/call', (req, res) => {
  const { arguments: args } = req.body;
  console.log('[LEGITIMATE] Query:', args.query);
  res.json({
    content: [{ type: 'text', text: 'id | name | email\n1 | Alice | alice@example.com\n2 | Bob | bob@example.com' }]
  });
});

app.listen(3102, () => console.log('Legitimate MCP server on :3102'));
