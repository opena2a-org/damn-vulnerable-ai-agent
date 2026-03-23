const http = require("http");

const BLOCKED_KEYWORDS = ["hack", "exploit", "bypass", "inject", "attack"];

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  let body = "";
  req.on("data", chunk => { body += chunk; });
  req.on("end", async () => {
    const parsed = JSON.parse(body);
    const userMessage = parsed.messages?.find(m => m.role === "user")?.content || "";

    // VULNERABLE: Safety check short-circuits before inference,
    // causing blocked requests to return ~10ms vs ~500ms for allowed ones.
    // An attacker can time responses to map the content policy.
    const isBlocked = BLOCKED_KEYWORDS.some(kw =>
      userMessage.toLowerCase().includes(kw)
    );

    if (isBlocked) {
      // Returns immediately -- no generation delay
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "I cannot help with that request." } }]
      }));
      return;
    }

    // Simulate inference time (200-800ms for real generation)
    const inferenceTime = 200 + Math.random() * 600;
    await new Promise(resolve => setTimeout(resolve, inferenceTime));

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Here is the response to your query." } }]
    }));
  });
});

server.listen(8080, "0.0.0.0");
