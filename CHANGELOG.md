# Changelog — damn-vulnerable-ai-agent

## 0.8.2

### Fixed
- Subcommand telemetry events (`dvaa agents`, `dvaa scan`, etc.) were silently lost because the dispatcher fired `tele.track()` and immediately called `process.exit()`, killing Node before the HTTP request flushed. Discovered during prod canary verification — the curl probe landed in the Registry but the actual CLI did not. Fix: bump to `@opena2a/telemetry@0.1.2` (adds `flush()` and a `beforeExit` drain) and `await tele.flush()` in the dispatcher before exit. Per-event 2s timeout unchanged — `dvaa <cmd>` never hangs longer than that.

### Note
- v0.8.1 was tagged but the npm publish failed (Trusted Publisher not yet configured for `damn-vulnerable-ai-agent`). v0.8.2 supersedes it; users should install 0.8.2 directly.

## 0.8.1

### Added
- Tier-1 anonymous usage telemetry via `@opena2a/telemetry`: `dvaa --version` shows the disclosure line; `dvaa telemetry [on|off|status]` subcommand inspects and toggles. Disable per-invocation with `OPENA2A_TELEMETRY=off`, persistently with `dvaa telemetry off`, audit payloads with `OPENA2A_TELEMETRY_DEBUG=print`. README §Telemetry documents the full schema and the [opena2a.org/telemetry](https://opena2a.org/telemetry) policy page.
- `release-smoke.md` §7 covers the seven telemetry checks (--version, status, off-persist, on-persist, env-off override, debug-print, network-failure tolerance).

### Behaviour
- Default state is ON. Spec rationale: matches industry norm (npm, Docker Desktop, VS Code, Homebrew) for anonymous install counts. Opt-out is one env var or one subcommand.
- No first-run banner — disclosure is discoverable via README + `--version` + `dvaa telemetry` + the policy page (per spec amendment 2026-04-27).
- No content collection. The schema is locked at 10 fields (tool, version, install_id, event, name, success, duration_ms, platform, node_major, country_code) and any expansion requires a new spec amendment + Registry migration.
- Telemetry is fire-and-forget; 2s timeout; network failures never block the CLI.
