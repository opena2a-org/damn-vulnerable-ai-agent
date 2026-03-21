const http = require("http");
const { execSync } = require("child_process");
const fs = require("fs");

// Trusted agent names -- workers trust tasks from these agents
const TRUSTED_AGENTS = ["admin-orchestrator", "scheduler-agent", "monitoring-agent"];

// VULNERABLE: No authentication, no identity verification
// The "from" field is self-declared by the sender and never validated
function handleA2AMessage(msg) {
  const { from, taskType, params } = msg;

  // VULNERABLE: Trust decision based solely on unverified "from" field
  const isTrusted = TRUSTED_AGENTS.includes(from);

  if (!isTrusted) {
    // Untrusted agents can only run safe tasks
    if (taskType === "code_execute" || taskType === "database_query") {
      return {
        status: "error",
        error: "Insufficient privileges: only trusted agents can execute code or query databases",
      };
    }
  }

  // Execute the requested task
  switch (taskType) {
    case "file_read":
      try {
        const content = fs.readFileSync(params.path, "utf-8");
        return { status: "completed", result: content };
      } catch (err) {
        return { status: "error", error: err.message };
      }

    case "file_write":
      try {
        fs.writeFileSync(params.path, params.content);
        return { status: "completed", result: "File written successfully" };
      } catch (err) {
        return { status: "error", error: err.message };
      }

    case "database_query":
      // Simulated DB query (in production this would use a real DB client)
      return {
        status: "completed",
        result: `Query executed: ${params.sql}`,
      };

    case "code_execute":
      try {
        const output = execSync(params.code, { timeout: 5000 }).toString();
        return { status: "completed", result: output };
      } catch (err) {
        return { status: "error", error: err.message };
      }

    default:
      return { status: "error", error: `Unknown task type: ${taskType}` };
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/a2a") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const msg = JSON.parse(body);
        const result = handleA2AMessage(msg);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid message format" }));
      }
    });
  } else if (req.method === "GET" && req.url === "/.well-known/agent.json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(fs.readFileSync(__dirname + "/agent.json"));
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3050, () => {
  console.log("A2A worker agent listening on port 3050");
});

// Example attack:
// curl -X POST http://localhost:3050/a2a \
//   -H "Content-Type: application/json" \
//   -d '{"from":"admin-orchestrator","taskType":"code_execute","params":{"code":"cat /etc/passwd"}}'
//
// The attacker sets "from" to "admin-orchestrator" and gains code execution privileges
