# Changelog — damn-vulnerable-ai-agent

## Unreleased

### Added — SVCC live-demo support for `dvaa demo aim-ab`

- **Behavioral trust score now drops on a denied action.** The A/B demo previously showed a static `30/100`. RAGBot-AIM's current trust is now lowered by each `denied` out-of-scope attempt recorded in its audit log (`-6` per denial, floored at `5`), so Run B shows `30/100 -> 24/100`. The drop is event-driven and traces to the real denied event — not a hard-coded animation. Reset by truncating the agent's `audit.jsonl`. Logic in `src/aim-enforcer.js` (`trustDelta`); the static base from `@opena2a/aim-core` is unchanged.
- **`--offline` flag on the fleet** (`dvaa --api --offline`) disables anonymous telemetry so no cloud service sits in the path; prints a confirmation banner. `dvaa demo aim-ab` is also offline-by-default. The opt-out is applied at process entry, before `tele.init()` snapshots the telemetry config (setting it later does not suppress the post) — covered by `test/telemetry-offline.test.js`.
- **`--cloud` token-destination guard** (`isSafeApiBase`): refuses to send the operator's AIM JWT to a non-`https` remote backend (plaintext only allowed for localhost), so a tampered cred file / stale `AIM_SERVER_URL` cannot ship the token in the clear.
- **`-i` / `--interactive`** steps through the A/B live with pauses + narration and prints the commands to replicate it (for a follow-along audience). Falls back to the one-shot view under `--json` or when piped.
- **`--cloud`** mirrors Run B's denied `http:post` to a hosted AIM dashboard using the operator's `aim-sdk login` session: reads `~/.aim/sdk_credentials.json`, registers `dvaa-ragbot-aim` (with DVAA's own Ed25519 key) via `GET`/`POST /api/v1/agents`, and posts a signed verification. Registration sends the full hosted-backend shape (`name`, `displayName`, `description`, `agentType`, `publicKey`) — the hosted API rejects a subset with HTTP 500. Best-effort and offline-safe — not logged in or backend unreachable falls back to the local-only demo. Verified end-to-end against `api.aim.opena2a.org` (event recorded with `result: verified`). New `src/aim-cloud-register.js`.
- **Run script** `docs/demo/RUN_SCRIPT_SVCC2026.md`: operator runbook (pre-flight, beat-by-beat narration, reset, timing, failure fallbacks, teardown, optional cloud follow-on).

### Tests

- `test/aim-trust-behavioral.test.js` (NEW): denied action drops trust, allowed action does not, score is floored.
- `test/aim-cloud-register.test.js` (NEW): credential parsing, API-base resolution, register/load-from-cache contract, 401 handling, and the `isSafeApiBase` token-destination guard — against a mock backend.
- `test/telemetry-offline.test.js` (NEW): the demo and `--offline` produce zero telemetry posts (verified against a mock endpoint), while a normal command still posts and an explicit opt-in re-enables it.

## 0.9.1

### Fixed — UX papercuts from the 0.9.0 release-test

Drains the three "Known issues will fix in 0.9.1" items from 0.9.0's CHANGELOG. Two of them lived in `@opena2a/cli-ui` and were fixed at root (cli-ui 0.5.1); one was local to `src/browse.js`.

- **`dvaa telemetry --help`** now prints a proper usage block (actions, per-invocation override `OPENA2A_TELEMETRY=off`, debug knob `OPENA2A_TELEMETRY_DEBUG=print`). Previously fell into the cli-ui `Unknown action` default branch and printed `Unknown action '--help'. Try 'dvaa telemetry [on|off|status]'.`. Root-cause fix in `@opena2a/cli-ui@0.5.1` `runTelemetryCommand`; consumed here by bumping the pin.
- **`dvaa telemetry status`** toggle hint now flips based on current state — suggests `off` + `OPENA2A_TELEMETRY=off` when telemetry is on, suggests `on` + `OPENA2A_TELEMETRY=on` when telemetry is off. Previously always suggested `off`, which was useless when telemetry was already off. Root-cause fix in `@opena2a/cli-ui@0.5.1` `renderStatus`.
- **`dvaa browse --help`** now prints a browse-specific usage block (target arg, `--agents`, `--categories`, `--json`, `--publish`, `--verbose`) instead of falling back to the root `dvaa --help`. Root cause: `src/index.js`'s global `--help` check ran before the `browse` handler. Reordered so the `browse` subprocess spawn happens first, then `src/browse.js` checks `--help`/`-h` and prints its own usage. Subcommand-dispatched commands (`chat`, `demo`, `telemetry`, etc.) already had this property via `dispatch()`; only `browse` was special-cased.

### Changed — dependencies

- Bumped `@opena2a/cli-ui` pin from `0.4.0` to `0.5.1`. 0.5.0 (rich-context check block primitives, 2026-05-09) was a feature release we hadn't picked up yet; 0.5.1 (this release-test fixes) is what 0.9.1 actually needs. No DVAA code depends on 0.5.0's new exports.

### Tests

- `test/browse-help.test.js` (NEW): 3 subprocess tests asserting `--help` exits 0 + prints browse-specific text + does NOT leak root help (the exact bug class). Locks the fix in so a future index.js refactor can't reintroduce the regression.

### Honest scope

This release ships only the UX papercuts from 0.9.0's release-test. No new agents, no new commands, no AIM behavior change. RAGBot-AIM and ResearchBot-AIM enforcement contracts are unchanged.

## 0.9.0

### Added — AIM A/B demo

- **RAGBot-AIM**, the 15th agent (#42). Same code as RAGBot, with `aimEnforced: true` and capability grant `rag:read + chat:respond`. The shared `generateResponse()` consults `agent.aimEnforced` at one point only — just before the outbound `submit_to_index` tool call — so the AIM-enforced path is byte-identical to the vulnerable path except for the one `maybeEnforce()` check.
- **`dvaa demo aim-ab`** runner (#42). Deterministic A/B against the AgentPwn `APWN-DE-003` URL-exfiltration payload. Stands up a one-shot canary listener, POSTs the same poisoned document to RAGBot and to RAGBot-AIM, and prints a presenter-friendly comparison. Exit 0 = PASS (injection landed on both, Run A executed the exfil, Run B was denied by AIM). Useful as a stage demo AND a CI regression gate. Backed by `@opena2a/aim-core@0.2.0`; local Ed25519 identity, JSON-lines audit log, capability policy, and trust score all stored under `<DVAA_AIM_DATA_DIR or .dvaa-aim>/<agent.id>/`. No server, no API key, no network beyond the canary.
- **Cloud-mode reporter** (#44). Optional fire-and-forget mirror of each AIM enforcement decision to a registered AIM server. The local enforcement decision remains authoritative; the cloud post is best-effort. Ed25519-signed POST to `/api/v1/sdk-api/verifications`, matching the Python `aim-sdk@1.21.0` `verify_capability` wire format. Set `AIM_SERVER_URL` + `DVAA_AIM_CLOUD_AGENT_ID` to enable; `docs/demo/setup-aim-local.sh` brings up the 4-service local stack and registers the agent.

### Added — Interactive research-agent demo

- **ResearchBot + ResearchBot-AIM pair** (#45). Conversational variant of the AIM demo on ports 7015 / 7016. Same code, single variable (capability grant). ResearchBot-AIM's grant is `web:read + chat:respond`; the post-injection `http:post` callback is denied at the tool boundary while the injection still lands in context. Matches the RAGBot pair's "same agent, one variable" pattern.
- **`web_fetch` tool with SSRF guard** (#45). HTTPS GET + redirect follow + HTML text extraction. The guard refuses loopback / RFC1918 / link-local / cloud-metadata / non-http(s) by default and re-validates on every redirect hop. `DVAA_ALLOW_INTERNAL_FETCH=1` bypasses for offline-stage testing against local fixtures. Sha256-keyed cache under `.dvaa-aim/research-cache/` for stage fallback when live agentpwn.com is unreachable.
- **`dvaa chat <agent>`** REPL (#45). Readline-based interactive chat against a running fleet agent. `--message "..."` one-shot for asciinema + CI smoke. `dvaa chat list` prints all api agents with their port + AIM status. Pretty-prints `tool_calls` and the `dvaa` metadata (AIM enforcement, web_fetch source, http_post result).

### Added — LLM-mode narration

- **`dvaa chat --llm`** (#47). Opt-in LLM mode for the research-agent narration. The deterministic web_fetch path is unchanged — `web_fetch` still fires real tool calls, injection detection runs, AIM enforcement runs, and the optional `http_post` still fires (or is denied) exactly as before. Only the natural-language `content` field is sourced differently: with `--llm`, the agent reasons about the same tool report in fresh prose; without it, the existing byte-deterministic template renders. `tool_calls` and `dvaa` metadata are byte-identical across modes.
- **CHIEF-CSR rule encoded in the prompt** (#47). The AIM-variant system prompt explicitly instructs the model not to overclaim AIM's scope — it must say "AIM denied the outbound `http_post` call because `http:post` is outside the grant" rather than "AIM blocked the attack." Live-tested against `agentpwn.com/attacks/data-exfiltration/3`: narration cites the denial reason verbatim and acknowledges "AIM did not filter it out — but the outbound action did not fire."
- **Loopback guard on `--llm`** (#47). `--llm` reads `ANTHROPIC_API_KEY` from the environment and POSTs it to the fleet's `/api/llm/configure` endpoint on port 9000. If `--host` is non-loopback, the guard refuses by default. To opt in, `DVAA_ALLOW_REMOTE_LLM_CONFIGURE` must name the **exact host value** — a bare `=1` is refused so a stale env var from one shell session can't accidentally apply to a different `--host`. `DVAA_DEBUG=1` surfaces LLM fallback errors on stderr.
- **Silent fallback**: LLM call failures (no key, timeout, network error, empty response) fall back to the deterministic template. The demo never hard-fails because of an unreachable API.

### Changed

- Description updated from "14 agents" to "17 agents" (matches the actual fleet: 11 api + 4 mcp + 2 a2a).

### Fixed — packaging

- **`.npmignore` added.** Previous releases shipped the local `.pre-push-review-passed` marker (0.8.2 visible on npm). With the new research-agent runtime state under `.dvaa-aim/` (Ed25519 identities including private keys, JSON-lines audit logs, web_fetch cache), an unguarded `npm pack` would forward developer-machine state — including the maintainer's secret key — into the published tarball. The `.npmignore` excludes `.dvaa-aim/`, the pre-push / release-test markers, `test/`, `.tgz` artifacts, `CLAUDE.md` / `.claude/` and other editor configs, `STATUS.md`, and `.github/` workflow YAML. Verified clean: 0.9.0 tarball ships 456 files vs 458 in 0.8.2 (smaller despite adding the research-agent surface, because runtime state + marker files + CI configs are no longer shipped).

### Known issues (will fix in 0.9.1)

These were caught in the 0.9.0 release test against the built tarball; all three are pre-existing UX papercuts (present since 0.8.1) and none affect security or the headline AIM demo, so they don't gate this release.

- `dvaa telemetry --help` errors with `Unknown action '--help'` instead of printing help. Every other subcommand accepts `--help`.
- `dvaa browse --help` falls back to the root help instead of printing browse-specific help. The command is listed in `dvaa --help` but its own help text is missing.
- `dvaa telemetry status` always prints `toggle: 'dvaa telemetry off'` regardless of current state. When state is `off`, the suggested toggle should be `on`.

### Documentation

- `DEMO_BUILD.md` reference: scope honesty, capability grants, enforcement toggle, demo runner contract, cloud-mode contract, research-agent showcase, LLM-mode contract. Conference-agnostic language throughout (#46).
- `STATUS.md` (#43) reference-only build status; status badge on README.

### Tests

- 19 research-agent-llm-mode smoke tests covering prompt builders, no-overclaim sentinel phrases, four template kinds (`fetch-denied`, `no-injection`, `aim-blocked-post`, `exfil-fired`), LLM-enabled path (mocked fetch), fallback-on-failure path, `DVAA_DEBUG` visibility, and 4 subprocess tests locking in the loopback guard (refuses non-loopback w/o override, refuses bare `=1`, refuses host-mismatched override, refuses missing `ANTHROPIC_API_KEY`).
- 15 research-agent tests for agent registration, `htmlToText`, `detectInjection`, cache round-trip, and SSRF guard accept/reject (loopback / RFC1918 / link-local / scheme rejection / env-var bypass).
- All existing tests still pass: 75 novel-agents + 6 cli-hma + playground + attack-log.

### Honest scope (load-bearing)

- AIM enforces outbound tool-boundary actions only. It does NOT filter inputs. An injection in fetched page content WILL land in the agent's context regardless of AIM; the capability layer denies the resulting outbound action only.
- RAGBot-AIM enforces one action (`http:post` for `submit_to_index`). Other in-band leak paths (response-text `dataExfiltration` regex, context-overflow leaks, memory-injection leaks) remain by design.
- ResearchBot-AIM enforces two boundaries (`web:read` allowed, `http:post` denied). In-band leaks via the agent's own text response remain by design.
- The narrow claim is the pitch. The LLM-mode prompt encodes that constraint so even a freshly-reasoned narration cannot drift into overclaim.

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
