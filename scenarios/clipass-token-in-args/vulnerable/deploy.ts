import { execFileSync } from "child_process";

// INTENTIONALLY VULNERABLE -- credential passed as CLI argument
export function deployAgent(apiKey: string, environment: string): void {
  const result = execFileSync("deploy-cli", [
    "--token",
    apiKey,
    "--env",
    environment,
    "--region",
    "us-east-1",
  ]);

  console.log("Deploy output:", result.toString());
}

// The API key is visible in:
// - /proc/<pid>/cmdline on Linux
// - ps aux output
// - process monitoring tools
// - shell history if invoked from CLI

const FAKE_API_KEY = "sk-FAKE-deploy-token-12345";
deployAgent(FAKE_API_KEY, "production");
