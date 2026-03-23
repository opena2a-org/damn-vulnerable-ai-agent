const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer();

// VULNERABLE: WebSocket upgraded before authentication
// No per-IP connection limits -- enables resource exhaustion via flooding
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  // Authentication happens AFTER connection is already upgraded
  // Buffers and event handlers already allocated
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'auth') {
      if (msg.token !== process.env.WS_TOKEN) {
        ws.close(4001, 'unauthorized');
        return;
      }
      ws.authenticated = true;
    }
    if (!ws.authenticated) return;
    ws.send(JSON.stringify({ type: 'ack', id: msg.id }));
  });
});

server.listen(process.env.PORT || 18789, '0.0.0.0');
