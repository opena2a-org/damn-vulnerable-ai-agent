# TOCTOU Race Between Verify and Apply

**Check:** None (see Detection status) | **Severity:** High | **Auto-Fix:** No

A configuration file is read and verified, then read again and applied as a separate operation. Between the two reads, an attacker can swap the file contents to bypass validation.

## How an Attacker Exploits It

The pipeline reads the config, validates it (rejects `dangerousMode: true`), then reads the same file path again to apply it. During the gap between verify and apply, the attacker replaces the file with a malicious version containing `dangerousMode: true`. The second read picks up the tampered file.

## Which HMA Check Detects It

TOCTOU-001 is designed to detect patterns where the same file path is read multiple times in a function without file locking, atomic operations, or content caching between the reads. It does not fire on this fixture in HackMyAgent 0.33.2; see Detection status.

## How to Fix It

- Read the file once and pass the in-memory content to both verify and apply
- Use file locking (`flock`) to prevent modification during the operation
- Use atomic file operations (rename-based) for config updates
- Verify the final content immediately before applying

**Detect:** `npx hackmyagent secure vulnerable/`

**References:**
- [CWE-367: Time-of-check Time-of-use (TOCTOU) Race Condition](https://cwe.mitre.org/data/definitions/367.html)

## Detection status

No check detects this fixture as of HackMyAgent 0.33.2 (static scan). `TOCTOU-001` detected it in HackMyAgent 0.11.15; in 0.33.2 the check still exists but does not fire on `pipeline.ts`.
