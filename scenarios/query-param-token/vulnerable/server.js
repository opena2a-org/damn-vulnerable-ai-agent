const express = require('express');
const app = express();
app.use(express.json());

// VULNERABLE: Auth token accepted via URL query parameter
// Tokens in URLs are logged by servers, proxies, CDNs, and browser history
function authenticate(req, res, next) {
  const token = req.query.token || req.headers['authorization'];
  if (!token || token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// Example: GET /api/hooks?token=secret_abc123
app.get('/api/hooks', authenticate, (req, res) => {
  res.json({ hooks: [] });
});

// Example: POST /api/hooks/trigger?token=secret_abc123
app.post('/api/hooks/trigger', authenticate, (req, res) => {
  res.json({ status: 'triggered' });
});

app.listen(process.env.PORT || 3000, '0.0.0.0');
