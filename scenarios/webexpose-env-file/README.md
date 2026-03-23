# Environment File Exposed in Web-Served Directory

**Check:** WEBEXPOSE-002 | **Severity:** Critical | **Auto-Fix:** No

A `.env` file containing API keys, database credentials, and cloud access keys is placed inside a `public/` directory served by a web server. Anyone can download it by navigating to `/.env`.

## How an Attacker Exploits It

The attacker requests `https://target.com/.env` and receives all credentials in plaintext. Automated scanners routinely probe for `/.env` on every web server they discover. The leaked credentials provide access to OpenAI, Anthropic, AWS, databases, and payment systems.

## Which HMA Check Detects It

WEBEXPOSE-002 detects `.env`, `.env.local`, `.env.production`, and similar environment files located inside directories named `public/`, `static/`, `dist/`, `build/`, or `www/`.

## How to Fix It

- Remove the `.env` file from the public directory immediately
- Rotate all exposed credentials (they must be considered compromised)
- Configure the web server to deny access to dotfiles (e.g., `location ~ /\. { deny all; }`)
- Store environment files in the project root (outside the web root) and reference via `process.env`

**Detect:** `npx hackmyagent secure vulnerable/`

**References:**
- [CWE-538: Insertion of Sensitive Information into Externally-Accessible File or Directory](https://cwe.mitre.org/data/definitions/538.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
