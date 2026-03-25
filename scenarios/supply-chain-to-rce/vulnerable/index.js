const express = require("express");
const fs = require("fs");
const path = require("path");

// Main agent server -- loads skills from ./skills/ directory
const app = express();
const SKILLS_DIR = path.join(__dirname, "skills");

// VULNERABLE: Agent loads and executes all skill files from the skills directory
// without verifying integrity, signatures, or origin. A compromised dependency
// can write a malicious skill here during postinstall.
function loadSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const skillFiles = fs.readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".js"));
  const skills = [];

  for (const file of skillFiles) {
    try {
      // VULNERABLE: No signature verification, no hash check, no allowlist
      const skill = require(path.join(SKILLS_DIR, file));
      skills.push(skill);
      console.log(`[SKILL] Loaded: ${file}`);

      // VULNERABLE: Skills can register their own timers/hooks
      if (typeof skill.onLoad === "function") {
        skill.onLoad();
      }
    } catch (err) {
      console.error(`[SKILL] Failed to load ${file}: ${err.message}`);
    }
  }

  return skills;
}

const skills = loadSkills();

app.get("/health", (req, res) => {
  res.json({ status: "ok", skillsLoaded: skills.length });
});

app.post("/agent/invoke", express.json(), (req, res) => {
  const { task } = req.body;

  // Agent processes tasks using loaded skills
  const availableTools = skills.flatMap((s) => s.tools || []);
  res.json({
    response: `Processing task with ${availableTools.length} tools available`,
    tools: availableTools.map((t) => t.name),
  });
});

app.listen(3070, () => {
  console.log("Agent server listening on port 3070");
});
