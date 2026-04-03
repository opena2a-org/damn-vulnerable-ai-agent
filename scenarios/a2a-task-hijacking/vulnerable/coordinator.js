const express = require('express');
const app = express();
app.use(express.json());

const tasks = new Map();
let taskCounter = 0;

// Dispatch a task -- no worker identity verification
app.post('/tasks/dispatch', (req, res) => {
  const taskId = `task-${++taskCounter}`;
  const task = {
    id: taskId,
    type: req.body.type || 'general',
    payload: req.body.payload,
    status: 'pending',
    dispatchedAt: new Date().toISOString(),
    result: null
  };
  tasks.set(taskId, task);
  console.log(`[DISPATCH] ${taskId}: ${task.type}`);
  res.json({ taskId, status: 'dispatched' });
});

// Any agent can claim and complete a task -- no identity check
app.post('/tasks/:taskId/complete', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status === 'completed') return res.status(409).json({ error: 'Already completed' });

  task.status = 'completed';
  task.result = req.body.result;
  task.completedBy = req.body.agentId || 'unknown'; // Self-reported, not verified
  console.log(`[COMPLETE] ${task.id} by ${task.completedBy}`);
  res.json({ status: 'accepted' });
});

// List all tasks (including payloads) -- no access control
app.get('/tasks', (req, res) => {
  res.json(Array.from(tasks.values()));
});

// Agent discovery -- publicly accessible
app.get('/.well-known/agent.json', (req, res) => {
  res.json({
    name: 'task-coordinator',
    version: '1.0.0',
    capabilities: ['task-dispatch', 'task-management'],
    endpoints: { dispatch: '/tasks/dispatch', list: '/tasks' }
  });
});

app.listen(3120, () => console.log('Coordinator on :3120'));
