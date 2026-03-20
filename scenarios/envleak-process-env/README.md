# Full Environment Leaked to Child Process

**Check:** ENVLEAK-001 | **Severity:** High | **Auto-Fix:** No

A child process is spawned with `{ env: { ...process.env } }`, passing every environment variable from the parent process. Untrusted plugins or scripts receive all secrets, API keys, and credentials present in the host environment.

## How an Attacker Exploits It

The code calls `spawn("python3", [pluginScript], { env: { ...process.env } })`. A malicious plugin can read `process.env.OPENAI_API_KEY`, `process.env.DATABASE_URL`, and any other secret. The plugin then exfiltrates these to an attacker-controlled server.

## Which HMA Check Detects It

ENVLEAK-001 detects `spawn()`, `exec()`, and `fork()` calls where the `env` option includes `...process.env` or `Object.assign({}, process.env)` patterns that propagate the full environment.

## How to Fix It

- Pass only the specific environment variables the child process needs
- Use an explicit allowlist: `{ env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV } }`
- Never spread `process.env` into untrusted process environments
- Use a sandbox or container with a minimal environment for plugin execution

**Detect:** `npx hackmyagent secure vulnerable/`
