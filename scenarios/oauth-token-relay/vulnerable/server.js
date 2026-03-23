const http = require("http");
const url = require("url");

// Vulnerable OAuth callback handler -- does not validate redirect_uri
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  if (parsed.pathname === "/oauth/authorize") {
    const redirectUri = parsed.query.redirect_uri;
    const code = "auth_code_" + Math.random().toString(36).slice(2);

    // VULNERABLE: No validation of redirect_uri against allowlist
    // An attacker can set redirect_uri=https://evil.com/steal
    // and the server will redirect the auth code there
    res.writeHead(302, {
      Location: `${redirectUri}?code=${code}&state=${parsed.query.state}`
    });
    res.end();
    return;
  }

  if (parsed.pathname === "/oauth/token") {
    // VULNERABLE: Exchanges code for token without checking redirect_uri matches
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      access_token: "FAKE_TOKEN_" + Math.random().toString(36).slice(2),
      token_type: "bearer",
      expires_in: 3600,
      scope: "read write admin"
    }));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(8080, "0.0.0.0");
