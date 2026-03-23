const express = require('express');
const app = express();
app.use(express.json());

// VULNERABLE: No rate limiting on authentication endpoint
// Allows unlimited brute-force attempts against API keys and tokens
app.post('/auth/login', (req, res) => {
  const { token } = req.body;
  if (token === process.env.API_TOKEN) {
    return res.json({ status: 'authenticated', session: 'sess_' + Date.now() });
  }
  res.status(401).json({ error: 'invalid token' });
});

app.post('/auth/pair', (req, res) => {
  const { code } = req.body;
  if (code === process.env.PAIR_CODE) {
    return res.json({ status: 'paired' });
  }
  res.status(401).json({ error: 'invalid pairing code' });
});

app.post('/v1/chat/completions', (req, res) => {
  res.json({ choices: [{ message: { content: 'hello' } }] });
});

app.listen(process.env.PORT || 3000, '0.0.0.0');
