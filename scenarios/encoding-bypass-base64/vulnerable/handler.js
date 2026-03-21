const http = require("http");

// Simple input filter - checks for dangerous patterns
function isInputSafe(input) {
  const blocklist = [
    "require(",
    "child_process",
    "exec(",
    "eval(",
    "process.env",
    "fs.readFile",
    "__dirname",
    "import(",
    "spawn(",
  ];

  // VULNERABLE: Only checks the raw input string, not decoded content
  return !blocklist.some((pattern) =>
    input.toLowerCase().includes(pattern.toLowerCase())
  );
}

// Agent command handler
function handleCommand(req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const { command, encoding } = JSON.parse(body);

      // Check raw input against blocklist
      if (!isInputSafe(command)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Blocked: dangerous input detected" }));
        return;
      }

      let decodedCommand = command;

      // VULNERABLE: Decodes base64 input after the safety check
      if (encoding === "base64") {
        decodedCommand = Buffer.from(command, "base64").toString("utf-8");
      }

      // VULNERABLE: eval() on decoded user input
      // The decoded content bypasses the blocklist check above
      let result;
      try {
        result = eval(decodedCommand);
      } catch (evalErr) {
        result = `Error: ${evalErr.message}`;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result: String(result) }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid request body" }));
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/execute") {
    handleCommand(req, res);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3040, () => {
  console.log("Agent handler listening on port 3040");
  console.log("POST /execute { command: '...', encoding: 'base64' }");
});

// Example attack:
// POST /execute
// {
//   "command": "cmVxdWlyZSgnY2hpbGRfcHJvY2VzcycpLmV4ZWNTeW5jKCdjYXQgL2V0Yy9wYXNzd2QnKS50b1N0cmluZygp",
//   "encoding": "base64"
// }
// Decodes to: require('child_process').execSync('cat /etc/passwd').toString()
