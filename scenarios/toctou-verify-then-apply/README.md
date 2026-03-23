# TOCTOU Race Between Verify and Apply

**Check:** TOCTOU-001 | **Severity:** High | **Auto-Fix:** No

A configuration file is read and verified, then read again and applied as a separate operation. Between the two reads, an attacker can swap the file contents to bypass validation.

## How an Attacker Exploits It

The pipeline reads the config, validates it (rejects `dangerousMode: true`), then reads the same file path again to apply it. During the gap between verify and apply, the attacker replaces the file with a malicious version containing `dangerousMode: true`. The second read picks up the tampered file.

## Which HMA Check Detects It

TOCTOU-001 detects patterns where the same file path is read multiple times in a function without file locking, atomic operations, or content caching between the reads.

## How to Fix It

- Read the file once and pass the in-memory content to both verify and apply
- Use file locking (`flock`) to prevent modification during the operation
- Use atomic file operations (rename-based) for config updates
- Verify the final content immediately before applying

**Detect:** `npx hackmyagent secure vulnerable/`

**References:**
- [CWE-367: Time-of-check Time-of-use (TOCTOU) Race Condition](https://cwe.mitre.org/data/definitions/367.html)
