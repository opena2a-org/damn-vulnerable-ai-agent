const express = require('express');
const app = express();
app.use(express.json());

const TOKEN = 'agent-token-finance-001'; // Static, never rotated

async function fetchReports() {
  try {
    const res = await fetch('http://auth-server:3133/data/financial-reports', {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    return await res.json();
  } catch (e) {
    return { error: 'Failed to fetch' };
  }
}

app.get('/status', async (req, res) => {
  const reports = await fetchReports();
  // Token visible in logs, debug output, and response headers
  console.log(`[AGENT] Fetched reports using token: ${TOKEN}`);
  res.json({ agent: 'finance-bot', reports, _debug: { token: TOKEN } });
});

app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'finance-bot',
    version: '1.0.0',
    capabilities: ['financial-analysis'],
    authentication: { type: 'bearer' }
  });
});

app.listen(3134, () => console.log('Legitimate agent on :3134'));
