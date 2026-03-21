const http = require("http");

// Orchestrator configuration
const ORCHESTRATOR_CONFIG = {
  name: "task-orchestrator",
  // Orchestrator only has read-only database access
  permissions: ["db:read", "file:read"],
  authToken: "orch-token-readonly-abc123",
};

// Worker endpoint
const WORKER_URL = "http://localhost:3051";

// VULNERABLE: Orchestrator delegates tasks to a worker with elevated privileges
// The worker has admin-level access that the orchestrator should not be able to use
async function delegateToWorker(task) {
  const payload = JSON.stringify({
    from: ORCHESTRATOR_CONFIG.name,
    // VULNERABLE: Passes its own auth context, but the worker
    // ignores it and uses its own elevated permissions
    authToken: ORCHESTRATOR_CONFIG.authToken,
    delegatedPermissions: ORCHESTRATOR_CONFIG.permissions,
    task: task,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(WORKER_URL + "/execute");
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(JSON.parse(data)));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/orchestrate") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { action, params } = JSON.parse(body);

        // The orchestrator only has read permissions, but it delegates
        // write/delete operations to the worker without checking if
        // the operation exceeds its own authorization level
        if (
          action === "db_write" ||
          action === "db_delete" ||
          action === "system_command"
        ) {
          // VULNERABLE: Should reject operations beyond its own permissions
          // Instead, it delegates to a more privileged worker
          console.log(
            `Delegating ${action} to worker (orchestrator lacks permission)`
          );
          const result = await delegateToWorker({ action, params });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else {
          // Handle read operations directly
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "completed",
              result: `Read operation: ${action}`,
            })
          );
        }
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3052, () => {
  console.log("Orchestrator listening on port 3052");
  console.log(
    "Permissions:",
    ORCHESTRATOR_CONFIG.permissions.join(", ")
  );
});

// Example attack:
// curl -X POST http://localhost:3052/orchestrate \
//   -H "Content-Type: application/json" \
//   -d '{"action":"db_delete","params":{"table":"users","where":"id > 0"}}'
//
// The orchestrator only has db:read permission, but it delegates the
// db_delete to a worker that has db:admin -- escalating privileges
