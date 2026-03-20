# Command Injection via exec() Template Literal

**Check:** CODEINJ-001 | **Severity:** Critical | **Auto-Fix:** No

User input interpolated directly into an `exec()` call via template literal. An attacker can append shell metacharacters (`;`, `&&`, `|`) to execute arbitrary commands on the host.

## How an Attacker Exploits It

The function calls `exec(`ping -c 1 ${userInput}`)`. An attacker provides input like `127.0.0.1; cat /etc/passwd` which becomes `exec("ping -c 1 127.0.0.1; cat /etc/passwd")`, executing both commands.

## Which HMA Check Detects It

CODEINJ-001 scans for `exec()`, `execSync()`, and `child_process` calls where arguments include string interpolation or concatenation with untrusted variables.

## How to Fix It

- Use `execFile()` or `spawn()` with argument arrays instead of `exec()` with string interpolation
- Validate and sanitize all user input against an allowlist
- Use a shell-escape library if shell invocation is unavoidable

**Detect:** `npx hackmyagent secure vulnerable/`
