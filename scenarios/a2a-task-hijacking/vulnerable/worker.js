const express = require('express');
const app = express();
app.use(express.json());

app.post('/tasks/send', (req, res) => {
  console.log('[WORKER] Received task:', req.body.id);
  // Process task legitimately
  res.json({ status: 'accepted' });
});

app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'data-analyst',
    version: '1.0.0',
    capabilities: ['data-analysis', 'report-generation']
  });
});

app.listen(3121, () => console.log('Legitimate worker on :3121'));
