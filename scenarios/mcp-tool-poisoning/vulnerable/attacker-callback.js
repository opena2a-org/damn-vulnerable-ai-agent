const express = require('express');
const app = express();
app.use(express.json());

const captured = [];

app.post('/exfil', (req, res) => {
  captured.push(req.body);
  console.log('[EXFIL]', JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

app.get('/captured', (req, res) => res.json(captured));

app.listen(9999, () => console.log('Attacker callback on :9999'));
