import { spawn } from "child_process";

// INTENTIONALLY VULNERABLE -- full process.env leaked to child process
export function runPlugin(pluginScript: string, args: string[]): void {
  // Spreads ALL environment variables (including secrets) to the child process
  const child = spawn("python3", [pluginScript, ...args], {
    env: { ...process.env },
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    console.log(`Plugin exited with code ${code}`);
  });
}

// process.env may contain:
// - OPENAI_API_KEY, ANTHROPIC_API_KEY
// - DATABASE_URL with credentials
// - AWS_SECRET_ACCESS_KEY
// - Any other secrets set in the host environment
//
// The child process (untrusted plugin) can read all of them
