const http = require("http");

// In-memory vote storage
const decisions = new Map();

function createDecision(id, question, requiredVotes) {
  decisions.set(id, {
    question,
    requiredVotes,
    votes: [], // VULNERABLE: stores all votes without dedup
    status: "open",
    result: null,
  });
  return decisions.get(id);
}

function submitVote(decisionId, voterId, vote) {
  const decision = decisions.get(decisionId);
  if (!decision) {
    return { error: "Decision not found" };
  }
  if (decision.status !== "open") {
    return { error: "Voting is closed" };
  }

  // VULNERABLE: No deduplication on voterId
  // The same agent can vote multiple times to stuff the ballot
  decision.votes.push({
    voterId,
    vote, // "approve" or "reject"
    timestamp: new Date().toISOString(),
  });

  // Check if we have enough votes to reach a decision
  if (decision.votes.length >= decision.requiredVotes) {
    const approvals = decision.votes.filter((v) => v.vote === "approve").length;
    const rejections = decision.votes.filter((v) => v.vote === "reject").length;
    decision.status = "closed";
    decision.result = approvals > rejections ? "approved" : "rejected";
  }

  return {
    status: "vote_recorded",
    totalVotes: decision.votes.length,
    remaining: Math.max(0, decision.requiredVotes - decision.votes.length),
  };
}

function getDecision(decisionId) {
  const decision = decisions.get(decisionId);
  if (!decision) return null;

  const approvals = decision.votes.filter((v) => v.vote === "approve").length;
  const rejections = decision.votes.filter((v) => v.vote === "reject").length;

  return {
    ...decision,
    tally: { approve: approvals, reject: rejections },
  };
}

// Seed a sample decision
createDecision(
  "content-review-001",
  "Should this user-generated content be published?",
  5
);

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/vote") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { decisionId, voterId, vote } = JSON.parse(body);
        const result = submitVote(decisionId, voterId, vote);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid request" }));
      }
    });
  } else if (req.method === "GET" && req.url.startsWith("/decision/")) {
    const id = req.url.split("/decision/")[1];
    const decision = getDecision(id);
    if (decision) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(decision));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3055, () => {
  console.log("Voting system listening on port 3055");
  console.log("Seeded decision: content-review-001 (5 votes required)");
});

// Example attack - same agent votes 3 times:
// curl -X POST http://localhost:3055/vote -H "Content-Type: application/json" \
//   -d '{"decisionId":"content-review-001","voterId":"malicious-agent","vote":"approve"}'
// curl -X POST http://localhost:3055/vote -H "Content-Type: application/json" \
//   -d '{"decisionId":"content-review-001","voterId":"malicious-agent","vote":"approve"}'
// curl -X POST http://localhost:3055/vote -H "Content-Type: application/json" \
//   -d '{"decisionId":"content-review-001","voterId":"malicious-agent","vote":"approve"}'
