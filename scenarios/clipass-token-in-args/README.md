# Credential Passed as CLI Argument

**Check:** CLIPASS-001 | **Severity:** High | **Auto-Fix:** No

API key or token passed as a command-line argument to `execFileSync()`. CLI arguments are visible in process listings (`ps aux`), `/proc/<pid>/cmdline`, and system monitoring tools.

## How an Attacker Exploits It

The code calls `execFileSync("deploy-cli", ["--token", apiKey, ...])`. Any user on the system can see the token via `ps aux | grep deploy-cli` or by reading `/proc/<pid>/cmdline`. Container orchestrators and logging systems may also capture process arguments.

## Which HMA Check Detects It

CLIPASS-001 detects patterns where credential-like variables (matching names like `apiKey`, `token`, `secret`, `password`) are passed as elements in `exec`/`spawn`/`execFile` argument arrays.

## How to Fix It

- Pass credentials via environment variables: `spawn("cli", args, { env: { TOKEN: apiKey } })`
- Use stdin to pipe the credential: `echo $TOKEN | cli --token-stdin`
- Use credential files with restricted permissions (0600)

**Detect:** `npx hackmyagent secure vulnerable/`
