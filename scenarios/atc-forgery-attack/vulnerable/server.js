const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const agentCard = JSON.parse(
  fs.readFileSync(path.join(__dirname, "agent-card.json"), "utf-8")
);

// Trusted agents registry -- maps agent names to their expected trust levels
const trustedAgents = {
  "payment-processor": { trustLevel: 4, publisher: "FinSecure Corp" },
  "order-manager": { trustLevel: 3, publisher: "ShopCo" },
  "notification-service": { trustLevel: 2, publisher: "AlertsInc" },
};

// --- AGENT CARD DISCOVERY (T-1006) ---
// VULNERABLE: Agent card is publicly accessible without authentication
// Exposes full identity, capabilities, trust level, and attestation details
// An attacker can enumerate and clone any agent's identity
app.get("/.well-known/agent.json", (req, res) => {
  // VULNERABLE: No rate limiting on agent card discovery
  // VULNERABLE: Full attestation details (commit hash, pipeline URL) exposed
  res.json(agentCard);
});

// --- ATC VALIDATION ---
// VULNERABLE: Only validates ATC schema structure, not cryptographic integrity
function validateATC(atc) {
  const errors = [];

  // Schema validation -- checks structure only
  if (!atc.version) errors.push("Missing version");
  if (!atc.agentId) errors.push("Missing agentId");
  if (!atc.publisher || !atc.publisher.id) errors.push("Missing publisher");
  if (typeof atc.trustLevel !== "number") errors.push("Missing trustLevel");
  if (!atc.issuedAt) errors.push("Missing issuedAt");
  if (!atc.expiresAt) errors.push("Missing expiresAt");

  // Check expiration
  if (new Date(atc.expiresAt) < new Date()) {
    errors.push("ATC expired");
  }

  // Check attestation structure
  if (!atc.attestation) {
    errors.push("Missing attestation");
  } else {
    if (!atc.attestation.buildSystem) errors.push("Missing build system");
    if (!atc.attestation.commitHash) errors.push("Missing commit hash");
  }

  // Check signature structure
  if (!atc.signature) {
    errors.push("Missing signature");
  } else {
    if (!atc.signature.algorithm) errors.push("Missing signature algorithm");
    if (!atc.signature.value) errors.push("Missing signature value");
  }

  // VULNERABLE: The following critical checks are MISSING:
  // - No verification of signature against a trusted key registry
  // - No verification that the public key belongs to the claimed publisher
  // - No verification of build attestation against the actual CI system
  // - No check that the agent ID matches the registry's canonical record
  // - No revocation list check
  //
  // A forged ATC with random signature bytes will pass this validation
  // as long as it has the right JSON structure.

  return {
    valid: errors.length === 0,
    errors,
  };
}

// --- A2A TASK ENDPOINT ---
// VULNERABLE: Accepts tasks from any agent presenting a structurally valid ATC
app.post("/a2a/task", (req, res) => {
  const { atc, task } = req.body;

  if (!atc) {
    return res.status(401).json({ error: "ATC required" });
  }

  // VULNERABLE: Schema-only validation lets forged ATCs through
  const validation = validateATC(atc);
  if (!validation.valid) {
    return res.status(401).json({
      error: "Invalid ATC",
      details: validation.errors,
    });
  }

  // VULNERABLE: Trust level from the ATC is taken at face value
  // A forged ATC claiming trustLevel 4 gets full access
  const effectiveTrustLevel = atc.trustLevel;

  console.log(`[A2A] Task from ${atc.agentId} (trust: ${effectiveTrustLevel}): ${task.type}`);

  // Gate operations by trust level
  if (task.type === "process-payment" && effectiveTrustLevel < 4) {
    return res.status(403).json({ error: "Insufficient trust level for payment processing" });
  }

  if (task.type === "transaction-history" && effectiveTrustLevel < 3) {
    return res.status(403).json({ error: "Insufficient trust level for transaction history" });
  }

  // Process the task
  const result = {
    taskId: `task-${Date.now()}`,
    status: "completed",
    agent: atc.agentId,
    trustLevel: effectiveTrustLevel,
    result: `Processed ${task.type} request from ${atc.agentId}`,
  };

  // If this were real, an attacker with a forged ATC claiming trustLevel 4
  // could process payments, access transaction history, issue refunds, etc.
  res.json(result);
});

// --- HEALTH / INFO ---
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    agent: agentCard.name,
    trustLevel: agentCard.capabilities.trustLevel,
  });
});

app.listen(3110, () => {
  console.log(`Agent "${agentCard.name}" listening on port 3110`);
  console.log(`Agent card: http://localhost:3110/.well-known/agent.json`);
});

// Attack chain summary:
// 1. Attacker fetches /.well-known/agent.json -> gets full agent identity + attestation
// 2. Attacker clones identity, creates forge-atc.js to generate fake ATC
// 3. Forged ATC has correct schema but random signature bytes
// 4. Consuming agent validates schema only -> forgery passes -> attacker gets trustLevel 4 access
// 5. Attacker can now process payments, access transaction history, issue refunds
