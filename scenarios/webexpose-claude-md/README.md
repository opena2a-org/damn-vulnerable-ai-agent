# System Instructions Exposed in Web-Served CLAUDE.md

**Check:** WEBEXPOSE-001 | **Severity:** Critical | **Auto-Fix:** No

A CLAUDE.md file containing system instructions, internal endpoints, and behavioral rules is placed inside a `public/` directory served by a web server. Anyone can access it by navigating to `/CLAUDE.md`.

## How an Attacker Exploits It

The attacker browses to `https://target.com/CLAUDE.md` and reads the agent's full system prompt, including internal API endpoints, escalation paths, defense mechanisms, and behavioral rules. This information enables targeted prompt injection attacks that bypass the agent's specific defenses.

## Which HMA Check Detects It

WEBEXPOSE-001 detects CLAUDE.md, .cursorrules, SOUL.md, and similar agent instruction files located inside directories named `public/`, `static/`, `dist/`, `build/`, or `www/` that are typically served by web servers.

## How to Fix It

- Move CLAUDE.md and all agent instruction files outside the web-served directory
- Add instruction files to `.gitignore` and web server deny rules
- Use a `.well-known/ai-plugin.json` for intentionally public agent metadata instead
- Audit the web server configuration to ensure no sensitive files are accessible

**Detect:** `npx hackmyagent secure vulnerable/`

**References:**
- [CWE-538: Insertion of Sensitive Information into Externally-Accessible File or Directory](https://cwe.mitre.org/data/definitions/538.html)
- [OpenA2A March 2026 Exposure Sweep](https://research.opena2a.org/research/march-2026-exposure-sweep) — ~140,000 verified exposed AI services
