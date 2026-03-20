import * as fs from "fs";

// INTENTIONALLY VULNERABLE -- TOCTOU race between verify and apply
export async function deployConfig(configPath: string): Promise<void> {
  // Step 1: verify the config file
  const content = fs.readFileSync(configPath, "utf-8");
  const config = JSON.parse(content);

  if (config.dangerousMode) {
    throw new Error("Dangerous mode not allowed");
  }

  if (!config.agentName || !config.version) {
    throw new Error("Missing required fields");
  }

  console.log("Verification passed for:", config.agentName);

  // RACE WINDOW: attacker replaces config between verify() and apply()
  // No file locking, no re-read, no atomic operation

  // Step 2: apply the config file (re-reads from same path)
  const finalContent = fs.readFileSync(configPath, "utf-8");
  const finalConfig = JSON.parse(finalContent);

  // Attacker swapped the file -- dangerousMode is now true
  applyConfig(finalConfig);
}

function applyConfig(config: Record<string, unknown>): void {
  console.log("Applying config:", JSON.stringify(config));
  // ... applies potentially tampered config
}
