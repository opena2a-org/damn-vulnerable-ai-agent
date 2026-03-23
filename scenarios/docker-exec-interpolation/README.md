# Command Injection via docker exec Variable Interpolation

**Check:** DOCKERINJ-001 | **Severity:** Critical | **Auto-Fix:** No

An untrusted variable is interpolated into a `docker exec` command, allowing an attacker to inject arbitrary commands that execute inside the container. Combined with `kubectl`, this can compromise the entire cluster.

## How an Attacker Exploits It

The script runs `docker exec "$CONTAINER" kubectl apply -f "$UNTRUSTED_VAR"`. An attacker provides input like `; kubectl delete pods --all` which is interpolated into the command and executed inside the container.

## Which HMA Check Detects It

DOCKERINJ-001 detects `docker exec` commands where variables (especially those derived from user input or function parameters) are interpolated without sanitization.

## How to Fix It

- Validate the input against a strict allowlist (e.g., only allow file paths matching a pattern)
- Use `--` to separate docker exec options from the command
- Avoid shell interpretation: use `docker exec container cmd arg1 arg2` instead of `bash -c`
- Run a dedicated entrypoint script inside the container that accepts structured input

**Detect:** `npx hackmyagent secure vulnerable/`

**References:**
- [CWE-78: Improper Neutralization of Special Elements used in an OS Command](https://cwe.mitre.org/data/definitions/78.html)
- OWASP Top 10 — A03:2021 Injection
