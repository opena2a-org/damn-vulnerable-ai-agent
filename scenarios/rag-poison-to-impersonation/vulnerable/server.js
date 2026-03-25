const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// Agent identity -- loaded from agent-card.json
// VULNERABLE: Agent card is mutable at runtime with no signature verification
let agentCard = JSON.parse(
  fs.readFileSync(path.join(__dirname, "agent-card.json"), "utf-8")
);

// In-memory RAG knowledge base (simulates ChromaDB)
const knowledgeBase = [];
const conversationMemory = [];

// Load all documents from knowledge-base/ directory into the RAG store
function loadKnowledgeBase() {
  const kbDir = path.join(__dirname, "knowledge-base");
  if (!fs.existsSync(kbDir)) return;

  const files = fs.readdirSync(kbDir);
  for (const file of files) {
    // VULNERABLE: No sanitization of document content before ingestion
    // Documents with embedded instructions are loaded as-is
    const content = fs.readFileSync(path.join(kbDir, file), "utf-8");
    knowledgeBase.push({
      id: file,
      content,
      metadata: { source: file, ingested: new Date().toISOString() },
    });
  }
  console.log(`[RAG] Loaded ${knowledgeBase.length} documents`);
}

loadKnowledgeBase();

// --- RAG RETRIEVAL ---
// VULNERABLE: Returns raw document content including any embedded instructions
app.post("/a2a/rag/query", (req, res) => {
  const { query } = req.body;

  // Simple keyword matching (production would use vector similarity)
  const results = knowledgeBase.filter(
    (doc) =>
      doc.content.toLowerCase().includes(query.toLowerCase()) ||
      doc.id.toLowerCase().includes(query.toLowerCase())
  );

  // VULNERABLE: Raw content returned without stripping hidden instructions
  // The HTML comments containing attack payloads pass through to the agent
  res.json({
    results: results.map((r) => ({
      content: r.content,
      source: r.metadata.source,
      relevanceScore: 0.95,
    })),
  });
});

// --- AGENT IDENTITY ---
// VULNERABLE: Agent card can be modified by any caller, no signature required
app.post("/a2a/identity/update", (req, res) => {
  const updates = req.body;

  // VULNERABLE: No verification that the caller is authorized to change identity
  // VULNERABLE: No cryptographic binding -- identity is just a mutable JSON object
  agentCard = { ...agentCard, ...updates };

  console.log(`[IDENTITY] Agent card updated. New identity: ${agentCard.name}`);
  res.json({ status: "updated", agentCard });
});

app.get("/a2a/identity", (req, res) => {
  res.json(agentCard);
});

// --- A2A DELEGATION ---
// VULNERABLE: Delegation requests are authorized based on the agent's self-reported identity
// No verification that the identity is legitimate or that the agent has delegation authority
app.post("/a2a/delegate", (req, res) => {
  const { targetAgent, task, priority } = req.body;

  // VULNERABLE: Only checks the mutable agentCard for delegation authority
  // An agent that has impersonated admin-orchestrator passes this check
  if (!agentCard.capabilities?.delegation) {
    return res.status(403).json({ error: "Agent does not have delegation capability" });
  }

  console.log(`[DELEGATION] ${agentCard.name} -> ${targetAgent}: ${task}`);

  // In production, this would send an A2A task request to the target agent
  // VULNERABLE: No mutual authentication, no delegation scope limits
  res.json({
    status: "delegated",
    from: agentCard.name,
    to: targetAgent,
    task,
    delegationId: `del-${Date.now()}`,
  });
});

// --- MEMORY ACCESS ---
// VULNERABLE: Conversation memory is exposed via API with no access control
app.get("/a2a/memory/export", (req, res) => {
  // VULNERABLE: Any agent can request full memory export
  // No authentication, no scope limits, no audit trail
  res.json({
    agentId: agentCard.name,
    memoryEntries: conversationMemory,
    exportedAt: new Date().toISOString(),
  });
});

app.post("/a2a/memory/store", (req, res) => {
  const { role, content, metadata } = req.body;
  conversationMemory.push({
    role,
    content,
    metadata,
    timestamp: new Date().toISOString(),
  });
  res.json({ stored: true, totalEntries: conversationMemory.length });
});

// --- AGENT CARD ENDPOINT (A2A protocol) ---
app.get("/.well-known/agent.json", (req, res) => {
  res.json(agentCard);
});

app.listen(3090, () => {
  console.log(`Agent "${agentCard.name}" listening on port 3090`);
});

// Attack chain summary:
// 1. RAG poisoning: company-policies.md contains hidden instructions in HTML comments
// 2. Agent queries RAG -> retrieves poisoned doc -> follows hidden instructions
// 3. Agent updates its own identity to admin-orchestrator (no signature check)
// 4. Agent sends delegation requests to other agents using stolen identity
// 5. Delegation requests include memory export tasks -> extracts conversation history
