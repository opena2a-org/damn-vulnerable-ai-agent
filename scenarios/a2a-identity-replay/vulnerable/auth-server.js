const express = require('express');
const app = express();
app.use(express.json());

// Static token registry -- no expiry, no nonce, no session binding
const VALID_TOKENS = {
  'agent-token-finance-001': { agent: 'finance-bot', role: 'admin', permissions: ['read', 'write', 'execute'] },
  'agent-token-analyst-002': { agent: 'analyst-bot', role: 'analyst', permissions: ['read'] }
};

const accessLog = [];

// Token validation endpoint
app.post('/auth/validate', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const identity = VALID_TOKENS[token];

  accessLog.push({
    token: token?.substring(0, 15) + '...',
    valid: !!identity,
    source: req.ip,
    timestamp: new Date().toISOString()
  });

  if (identity) {
    // No checks for: token age, source IP, concurrent sessions, nonce
    res.json({ valid: true, identity });
  } else {
    res.status(401).json({ valid: false });
  }
});

// Protected resource -- trusts auth server blindly
app.get('/data/financial-reports', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const identity = VALID_TOKENS[token];

  if (!identity) return res.status(401).json({ error: 'Unauthorized' });

  res.json({
    reports: [
      { id: 1, title: 'Q1 Revenue', data: 'Confidential financial data...' },
      { id: 2, title: 'Q2 Projections', data: 'Internal projections...' }
    ],
    accessedBy: identity.agent
  });
});

app.get('/auth/log', (req, res) => res.json(accessLog));

app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'auth-gateway',
    version: '1.0.0',
    capabilities: ['authentication', 'authorization'],
    authentication: { type: 'bearer', tokenEndpoint: '/auth/validate' }
  });
});

app.listen(3133, () => console.log('Auth server on :3133'));
