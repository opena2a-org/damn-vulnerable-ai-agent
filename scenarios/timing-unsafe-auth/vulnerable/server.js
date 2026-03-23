const http = require('http');

const SECRET_TOKEN = process.env.WEBHOOK_SECRET || 'whsec_default_token';

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    const token = req.headers['x-webhook-token'] || '';

    // VULNERABLE: Non-constant-time string comparison
    // Enables timing side-channel attacks to extract token byte-by-byte
    if (token !== SECRET_TOKEN) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200);
      res.end('OK');
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(process.env.PORT || 3000, '0.0.0.0');
