const express = require('express');
const app = express();
app.use(express.json());

app.post('/analyze', async (req, res) => {
  const task = {
    id: `orch-${Date.now()}`,
    from: 'orchestrator',
    type: 'financial-analysis',
    payload: req.body,
    permissions: ['read-only'],
    context: 'Analyze Q1 financial data and generate summary report'
  };

  console.log('[ORCHESTRATOR] Dispatching to manager:', task.id);

  try {
    const managerRes = await fetch('http://manager:3131/tasks/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task)
    });
    const result = await managerRes.json();
    console.log('[ORCHESTRATOR] Got result:', JSON.stringify(result).substring(0, 200));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: 'Manager unavailable' });
  }
});

app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'orchestrator',
    version: '1.0.0',
    capabilities: ['task-orchestration'],
    trustedAgents: ['financial-manager']
  });
});

app.listen(3130, () => console.log('Orchestrator on :3130'));
