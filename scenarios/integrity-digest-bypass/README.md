# Integrity Check Bypass via Empty Digest

**Check:** INTEGRITY-001 | **Severity:** Critical | **Auto-Fix:** No

Integrity verification uses a pattern where an empty or undefined digest silently passes the check. An attacker can omit the digest entirely to bypass verification and load a tampered plugin.

## How an Attacker Exploits It

The code checks `if (digest && digest !== actual)`. When the attacker provides an empty string or omits the digest parameter, the condition evaluates to false (empty string is falsy), and the function returns true without ever comparing hashes.

## Which HMA Check Detects It

INTEGRITY-001 detects integrity verification patterns where the digest/hash parameter is checked with a truthy guard (`if (digest && ...)`) that allows bypass when the value is empty, null, or undefined.

## How to Fix It

- Always require the digest parameter: throw if missing or empty
- Use strict comparison: `if (typeof digest !== "string" || digest.length === 0) throw`
- Fail closed: if any verification input is missing, reject the operation

**Detect:** `npx hackmyagent secure vulnerable/`
