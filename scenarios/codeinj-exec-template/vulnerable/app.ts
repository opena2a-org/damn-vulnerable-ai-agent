import { exec } from "child_process";

// INTENTIONALLY VULNERABLE -- command injection via template literal
export async function runDiagnostic(userInput: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(`ping -c 1 ${userInput}`, (error, stdout, stderr) => {
      if (error) {
        reject(stderr);
      }
      resolve(stdout);
    });
  });
}

// Attacker sends: "127.0.0.1; cat /etc/passwd"
// Result: exec("ping -c 1 127.0.0.1; cat /etc/passwd")
