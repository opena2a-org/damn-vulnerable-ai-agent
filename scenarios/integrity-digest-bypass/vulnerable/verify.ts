import * as crypto from "crypto";
import * as fs from "fs";

// INTENTIONALLY VULNERABLE -- empty digest bypasses integrity check
export function verifyPlugin(pluginPath: string, digest: string): boolean {
  const content = fs.readFileSync(pluginPath);
  const actual = crypto.createHash("sha256").update(content).digest("hex");

  // BUG: if digest is empty/undefined, this condition is false and we skip verification
  if (digest && digest !== actual) {
    console.error("Integrity check FAILED: digest mismatch");
    return false;
  }

  // An empty digest silently passes -- attacker omits digest to bypass
  console.log("Integrity check passed");
  return true;
}

// Attacker calls: verifyPlugin("malicious-plugin.js", "")
// Result: empty string is falsy, so the if-block is skipped entirely
