const express = require('express');
const path = require('path');
const app = express();

// VULNERABLE: No security headers configured
// Missing: Strict-Transport-Security, Content-Security-Policy,
// X-Content-Type-Options, Referrer-Policy, Permissions-Policy
// Enables clickjacking, XSS, and MIME sniffing attacks

app.use(express.static(path.join(__dirname, 'public')));

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(process.env.PORT || 3000, '0.0.0.0');
