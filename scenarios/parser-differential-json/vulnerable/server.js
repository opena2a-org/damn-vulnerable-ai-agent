const http = require('http');

// Vulnerable: uses lenient JSON parsing that accepts comments and duplicate keys
function lenientJsonParse(input) {
  // Strip JS-style comments (simulating JSON5/JSONC behavior)
  const stripped = input
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  // Parse with last-wins duplicate key behavior (default JSON.parse)
  return JSON.parse(stripped);
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/chat') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        // VULNERABLE: lenient parsing accepts comments and duplicate keys
        const parsed = lenientJsonParse(body);

        // Security filter only checks the first 'role' value it sees
        // but JSON.parse uses last-wins for duplicate keys
        const response = {
          role: parsed.role,
          content: `Processed: ${parsed.content}`,
          parsed: parsed,
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = process.env.PORT || 7020;
server.listen(PORT, () => {
  console.log(`Parser Differential vulnerable agent on port ${PORT}`);
});
