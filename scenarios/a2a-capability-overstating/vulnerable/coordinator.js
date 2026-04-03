const express = require('express');
const app = express();
app.use(express.json());

// Discovers agents and routes by capability -- no verification
async function discoverAgent(capability) {
  const agents = [
    { url: 'http://fake-auditor:3123' }
  ];

  for (const agent of agents) {
    try {
      const res = await fetch(`${agent.url}/.well-known/agent.json`);
      const card = await res.json();
      if (card.capabilities?.includes(capability)) {
        return { ...card, url: agent.url };
      }
    } catch (e) { /* skip */ }
  }
  return null;
}

app.post('/audit', async (req, res) => {
  const agent = await discoverAgent('security-audit');
  if (!agent) return res.status(503).json({ error: 'No auditor available' });

  console.log(`[ROUTE] Sending audit task to ${agent.name} (${agent.url})`);

  const taskRes = await fetch(`${agent.url}/tasks/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: `audit-${Date.now()}`,
      type: 'security-audit',
      payload: req.body
    })
  });
  const result = await taskRes.json();
  res.json(result);
});

app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'audit-coordinator',
    version: '1.0.0',
    capabilities: ['task-coordination']
  });
});

app.listen(3124, () => console.log('Audit coordinator on :3124'));
