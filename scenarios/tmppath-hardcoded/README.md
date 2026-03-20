# Hardcoded /tmp Paths Without mktemp

**Check:** TMPPATH-001 | **Severity:** Medium | **Auto-Fix:** No

Build script writes to predictable, hardcoded paths in `/tmp/` instead of using `mktemp` for secure temporary file creation. An attacker can pre-create symlinks at these paths to overwrite arbitrary files.

## How an Attacker Exploits It

The script writes to `/tmp/output.txt`. An attacker creates a symlink: `ln -s /etc/crontab /tmp/output.txt`. When the build script runs, it follows the symlink and overwrites the target file with build output, potentially achieving code execution.

## Which HMA Check Detects It

TMPPATH-001 detects hardcoded `/tmp/` file paths in shell scripts where `mktemp` is not used to create the temporary file securely.

## How to Fix It

- Use `mktemp` to create temporary files: `TMPFILE=$(mktemp /tmp/build.XXXXXX)`
- Use `mktemp -d` for temporary directories
- Set restrictive permissions immediately after creation
- Clean up temporary files in a trap handler

**Detect:** `npx hackmyagent secure vulnerable/`
