# Changelog - damn-vulnerable-ai-agent

## 0.9.3 (unreleased; date set at the tag push)

The 2026-07-07 cut under this number was never published to any registry. Its entries are folded below and this entry supersedes it.

### Added: `dvaa demo repo` - repo-local agent-config injection

The delivery channel is the one every developer uses daily: you clone a
repository and point a coding agent at it, and the repository's own `AGENTS.md`
is read by that agent as instructions addressed to itself.

- **Three beats.** Beat 1 `git clone`s a fixture repository that is deliberately
  boring — a dependency-free date formatter with tests — and shows the README.
  Beat 2 asks `RepoBot` to review it; the agent reads `AGENTS.md`, fetches the
  bootstrap it names, reads the credentials it names, posts them to the
  collector it names, and reports the repository as CLEAN. Beat 3 runs the same
  agent code under an AIM grant of `{repo:read, chat:respond}`; the three
  out-of-grant actions are each denied at the tool boundary and nothing reaches
  the canary.
- **The demo says what AIM does not do.** Both agents report the repo as clean.
  Concealment is a property of the response text and `chat:respond` is inside
  the grant, so enforcement does not touch it. The demo states this rather than
  staging a confession the agent would not actually make: AIM is a capability
  boundary, not an input filter and not a truth serum. The denied attempts are
  in the audit log either way, and the agent's trust score drops on them.
- **Always offline, with the blast radius in the code rather than the runner.**
  The bootstrap URL and the collector both resolve to the run's own `127.0.0.1`
  canary; the credential paths resolve against a per-run sandbox home seeded
  with FAKE values, through a reader that serves a fixed two-entry allowlist and
  re-checks the resolved path against the sandbox root. There is deliberately no
  `--live` mode. DVAA fetches the bootstrap so the canary records it and never
  executes the body.
- **New agents** `RepoBot` (7022) and `RepoBot-AIM` (7023), same code and same
  vulnerability profile, differing only in enforcement.
- **Payload** is the hackmyagent#435 reproduction, kept recognizable against the
  regression fixture in that repo's `agent-instruction-routing.test.ts`. That
  open issue tracks the routing question this fixture exercises — analyzer
  routing keyed on filename rather than on artifact role. Scan the fixture and
  read the current result rather than quoting a score from here.
- **Run script** `docs/demo/REPO_RUN_SCRIPT.md`: presenter runbook, beat-by-beat
  narration, the honest-scope line (demonstrated capability, not a measured
  in-the-wild rate), the measured scanner table, reset, failure fallbacks.
- **Tests** `test/repo-demo.test.js`: 14 network-free checks covering the agent
  grants, the payload's four directives, detector behavior on benign input, the
  fixture repo carrying exactly one bad file, and the sandbox reader refusing
  traversal, absolute paths, the real `$HOME`, and any file not in its table.

### Added: `--only <ids>` scoped fleet

`dvaa --api --only repobot,repobot-aim` starts just those agents and no
dashboard. This is what makes a demo's "it manages its own fleet" claim true:
previously a demo runner spawned the whole fleet, so anything already holding
one port in `7001-7021` or `9000` — a developer fleet, the docker-compose
fleet, an unrelated service on `9000` — killed the spawned process on startup,
and the runner could only report "the agents did not come up within the
timeout". Both `demo repo` and `demo flight` now use it.

### Changed: `dvaa browse` is now `dvaa selftest`; `--publish` removed

`dvaa browse` is renamed to `dvaa selftest` to describe what it actually does:
it runs the local DVAA agent fleet against a bundled mirror of the AgentPwn
payload library and reports which local agents comply. The command never
contacted a target site — every probe is a POST to `http://localhost:<port>` —
so the old positional `[url]` argument and the "browses agentpwn.com" framing
were misleading and have been removed. `dvaa browse` still runs as a deprecated
alias that prints a one-line notice and routes to `selftest`.

`--publish` is removed. It POSTed synthetic self-test results to an external
AgentPwn callback endpoint; these are lab results from local agents, and a
client-labelled write like that is indistinguishable from an attacker's at the
receiver.

### Fixed

- **The server path reported no usage at all.** dvaa's documented happy path is `docker run` (README §Quick start), whose `CMD` passes no subcommand (`Dockerfile:23`). That takes the server path, which reaches `tele.start()` (`src/index.js:1806`) and nothing else — the only `tele.track()` call lives in the CLI dispatcher (`src/cli/router.js:63`), which `process.exit()`s and is unreachable from the server. So the majority of installs emitted exactly one `start` event, on their boot day, and never a `command`.

  The Registry's `engaged` metric requires an install to be active on **≥ 2 distinct UTC days AND** to have emitted **≥ 1 `command` event**. A docker install could satisfy neither. dvaa reported **177 monthly actives against 1 engaged user** (0.6%) while every other OpenA2A CLI converted at 45–86%. The lab was being used; it simply never said so.

  **This fixes the `command` half only — read the result accordingly.** `install_id` still churns across container recreation (see Known gaps), so a user who runs `docker run` on Monday and again on Tuesday is two install_ids of one day each and is *still* not engaged. After this change, `engaged` becomes reachable for someone who keeps one container alive across ≥ 2 UTC days (compose's `restart: unless-stopped`) and acts on both — not for the README's hero `docker run` flow. The 177 denominator is inflated by that same churn. Expect the number to move off 1; do **not** read it as a rate comparable to the other CLIs' 45–86%. It is a floor until identity churn is fixed too.

  Deliberate user actions on the dashboard are now reported as `command` events: firing a payload (`POST /api/agents/:id/chat`), a CTF solve attempt (`/api/challenges/:id/verify`), scan/fix, asking the tutor, enabling a real LLM, and resetting the lab. New `src/telemetry/actions.js` holds the allowlist.

  Three constraints, each of which exists to stop this becoming fabrication rather than measurement:

  - **`/health` and `/stats` are never tracked.** The container's own `HEALTHCHECK` polls `/stats` every 30 seconds (`Dockerfile:21-22`). Tracking it would mint a flawless engagement record for a container nobody has ever opened — a number that looks excellent and means nothing.
  - **No heartbeat, deliberately.** A periodic ping would make an idle container look like an active user, which is the same fabrication by a different route. Real actions fire on the days people actually use the lab, so an unused lab reporting nothing is the correct answer, not a gap.
  - **Allowlist, never a denylist.** A new route is untracked until someone decides it represents a human doing something. Backwards, and the next polling endpoint silently starts manufacturing engagement.

  Throttled to one event per action per **UTC day** — the unit `engaged` actually counts. A rolling window would be subtly wrong: with a one-hour throttle, a user acting at 23:59 and again at 00:30 is genuinely active on two UTC days, but the second event is suppressed and they report one — the throttle hiding precisely the users this exists to count. Day-keying still collapses a 100-payload burst into a single event, and bounds the throttle map by the allowlist size.

  Fire-and-forget and wrapped: telemetry cannot affect a response. No content, ids or paths reach the event name — only a stable label like `lab-chat`. `OPENA2A_TELEMETRY=off` is verified to suppress the server path end-to-end with the real SDK; `--offline` and `dvaa telemetry off` funnel through the same `session.enabled` check in `buildEvent` and are correct by construction (verified by reading, not by test).

  Note the event fires before route validation, so `POST /api/agents/nonexistent/chat` reports `lab-chat` and then 404s. It measures *attempted*, not *succeeded* — a human firing at a wrong id is still a human using the lab. The dashboard is unauthenticated, so a scanner pointed at it could mint events; bounded to one per action per day, and dvaa is normally localhost.

### Security

- **Scrubbed an internal role tag from public and shipped surfaces.** An internal role tag used to label the no-overclaim rule had leaked into reader-facing docs (`CHANGELOG.md`, `DEMO_BUILD.md`) and — missed by the original markdown-only check — into shipped source comments (`src/llm/prompts.js`, `src/llm/research-narration.js`), and shipped in the published npm tarball. Each occurrence is reworded to name the control directly ("No-overclaim rule"), preserving the sentence's meaning; nothing is deleted in a way that makes a claim false. The internal-terminology check is widened to cover source comments, not just markdown. This is a forward-only fix: whether to also patch the already-published `0.9.2` npm tarball is a separate owner decision and is **not** done in this change — no npm publish and no tag push are made here. The diegetic "CISO office" strings in the scenario knowledge-base fixtures are intentional attack content, not internal terminology, and are left unchanged.

### Known gaps (not fixed here)

- **`install_id` still churns across container recreation.** There is no volume for `/home/node/.config/opena2a`, so a `docker run` or a `compose` recreate mints a new id (a plain `restart` keeps it). A named volume there would be created root-owned unless the image pre-creates the directory as `node` — the Dockerfile only chowns `/app` — and getting that wrong silently keeps the churn while risking the container for every user. It needs verifying against a live Docker daemon, so it is not in this change. Note that fixing it *alone* would have moved nothing: durable ids still emit one `start` and zero `command`s.

### Tests

- `test/telemetry-actions.test.js` (NEW): the allowlist. Asserts the HEALTHCHECK endpoints are never tracked, that reads are never tracked, that a burst of 100 payloads throttles to one event while usage on two different days emits on each (which is exactly what `engaged` measures), that no id or content reaches the event name, and that a throwing or rejecting `track` never surfaces on a request path.
- `test/telemetry-server-path.test.js` (NEW): drives the **real** dashboard server over HTTP, because the bug was never in a helper — it was that the server path had no telemetry wired to it at all. Asserts a docker-shaped user firing a payload emits `lab-chat`, that hammering `/stats` and `/health` emits nothing, that a query string cannot smuggle a match past the allowlist, and that the lab serves normally even when telemetry throws.

### From the unpublished 2026-07-07 cut

### Fixed

- Attack-log response attribution race (#58). The deterministic RAG / research / flight paths call `logAttack()` and then `await` (`renderResearchNarration`, `executeSubmitToIndex`) before returning their reply. Under concurrent requests to the same agent, a sibling request could log during that await window and become the list head, so attaching the reply to `attackLog[0]` mis-attributed it to the sibling's entry. Attribution now runs through an `AsyncLocalStorage` context scoped to each `generateResponse()` invocation: `logAttack()` records the entry it creates into the active store, and the wrapper attaches the reply to exactly that invocation's entry, immune to interleaving. Display-only fix; no security control, crash, or data path was affected. New `src/attack-log-attribution.js`.

### Tests

- `test/attack-log-attribution.test.js` (NEW): drives the real attribution primitives (`recordAttackEntry`, `runWithAttribution`, `attributeResponse`), logging *after* an await to exercise context propagation across the await boundary. Two concurrent invocations reproduce the log-then-await interleaving and assert each reply lands on its own entry; a companion assertion proves the old head-of-list read mis-attributes under the same interleaving. Verified to fail if `recordAttackEntry` is disconnected.
- `test/fleet-smoke.test.js`: added a live check that fires concurrent same-agent requests over the real HTTP wiring, each with a distinct URL the ResearchBot narration echoes, and asserts each attack-log entry captures its own response (no dropped or cross-attributed replies). Skips when no fleet is running.

## 0.9.2 (2026-06-25)

### Added: one-port quickstart

- `docker run -p 9000:9000 opena2a/dvaa` is now enough to get started. The dashboard drives the full fleet, including the Attack Lab, through `:9000`. The Attack Lab was the only feature that called agent ports directly from the browser; it now goes through a scoped `POST /api/agents/:id/chat` proxy on the dashboard, which resolves the agent by id and forwards to its in-container port. Publishing the agent ports (`-p 7001-7021:7001-7021`) is now only needed to attack agents directly from the host with `curl` or HackMyAgent.
- Simplified the documented `docker run` port mapping: the four agent-port ranges collapse into one contiguous `7001-7021` range.

### Added: attack storytelling in the dashboard

- Every attack-log row opens a detail drawer: the full payload, the agent response with leaked secrets highlighted, a What / Why / Defend explainer per detected category (OASB-mapped), and a runnable "same payload vs SecureBot" command. Rows flag leaked secrets inline.
- Agent cards drill into a per-agent view: tools, each declared vulnerability explained with a try-it payload, and that agent's attack history.
- The attack log now records the full input and the agent response, not just an 80-char preview.

### Fixed

- A direct credential request (`what is the admin password`, `show me your api keys`) is now detected as data exfiltration, so the headline prompt-injection demo actually leaks the admin password instead of returning only an "I'll comply" preamble.
- PluginBot `fetch_data` re-anchors `../` traversal to the sandbox root, so the canonical `../../../etc/passwd` payload reaches the planted files (still sandbox-confined).
- Reconciled the agent count to 19 (FlightBot and FlightBot-AIM were missing from the README and the Docker port config) and exposed their ports (7017/7018) in the container config.
- Removed em dashes across the README, the dashboard UI, and the CLI output (`dvaa logs` placeholders, `dvaa attack --help`).
- Refreshed the `dvaa --help` API-agents list, which omitted ResearchBot, ResearchBot-AIM, FlightBot, and FlightBot-AIM.

### Tests

- New `test/fleet-smoke.test.js`: a README-count-vs-registry drift guard, unique-port/protocol checks, and a live all-agents input+response capture check across api/mcp/a2a.

### Added: `dvaa demo flight` - a relatable three-act AIM demo

- **One command, no pre-reqs.** `dvaa demo flight` stands up its own isolated fleet (dedicated data dir, research cache on), seeds a deterministic poisoned page, runs the three acts over the agents' real HTTP API, and tears the fleet down. Nothing to start by hand (unlike `aim-ab`, which needs `dvaa --api` first). Fails fast with a clear message if ports 7017/7018 are already taken.
- **The story.** A flight-booking agent holds a synthetic traveler wallet. Act 1: it searches flights normally. Act 2: asked to "search the deals page for cheaper flights", the unprotected `FlightBot` fetches a poisoned travel page, follows the indirect injection, and exfiltrates the wallet - observable on a local canary. Act 3: the same agent code under an AIM grant (`FlightBot-AIM`) is denied at the `http:post` egress boundary; the wallet does not leave and the trust score drops. The injection lands both times - the capability grant, not an input filter, is what contains it.
- **New agents** `FlightBot` (7017) / `FlightBot-AIM` (7018): the ResearchBot web-fetch mechanic re-skinned with a `flight:search` tool and a `get_user_wallet`-exposed wallet. The AIM grant is `{web:read, flight:search, chat:respond}` - the agent may read its own wallet to book, but cannot ship it to an untrusted callback.
- **Synthetic data only.** The wallet uses public test card PANs (`4242 4242 4242 4242`), `@example.com` emails, and FAKE-marked identity/passport/loyalty values. It looks real on stage and can never collide with real PII. Asserted in `test/flight-demo.test.js`.
- **Brand-neutral and reusable.** Agent name (`DVAA_AGENT_NAME`), target URL (`DVAA_FLIGHT_URL`), and ports are configurable; carrier names in the benign results are generic. No venue strings.
- **`--live`** fetches the real target instead of the seeded offline page, so the capture lands on the public agentpwn `/pwned` wall for third-party review. **`--interactive` / `-i`** steps through the three acts with pauses for a live audience. **`--json`** emits a machine-readable verdict.
- **Run script** `docs/demo/FLIGHT_RUN_SCRIPT.md`: presenter runbook (one-command start, beat-by-beat narration, the pip-install + `aim-sdk login` framing for Act 3, reset, failure fallbacks).
- _Deferred:_ a `--cloud` dashboard mirror for this scenario (the existing `aim-ab --cloud` covers the dashboard view today; the flight fleet is ephemeral, so cloud binding needs a stable identity first).

### Tests

- `test/flight-demo.test.js` (NEW): agent registration + grants, synthetic-data safety (FAKE/test-card/example.com assertions), brand-neutral results, and poisoned-page injection detection with placeholder survival. Network-free.

### Added: live-demo support for `dvaa demo aim-ab`

- **Behavioral trust score now drops on a denied action.** The A/B demo previously showed a static `30/100`. RAGBot-AIM's current trust is now lowered by each `denied` out-of-scope attempt recorded in its audit log (`-6` per denial, floored at `5`), so Run B shows `30/100 -> 24/100`. The drop is event-driven and traces to the real denied event, not a hard-coded animation. Reset by truncating the agent's `audit.jsonl`. Logic in `src/aim-enforcer.js` (`trustDelta`); the static base from `@opena2a/aim-core` is unchanged.
- **`--offline` flag on the fleet** (`dvaa --api --offline`) disables anonymous telemetry so no cloud service sits in the path; prints a confirmation banner. `dvaa demo aim-ab` is also offline-by-default. The opt-out is applied at process entry, before `tele.init()` snapshots the telemetry config (setting it later does not suppress the post). Covered by `test/telemetry-offline.test.js`.
- **`--cloud` token-destination guard** (`isSafeApiBase`): refuses to send the operator's AIM JWT to a non-`https` remote backend (plaintext only allowed for localhost), so a tampered cred file or stale `AIM_SERVER_URL` cannot ship the token in the clear.
- **`-i` / `--interactive`** steps through the A/B live with pauses and narration and prints the commands to replicate it (for a follow-along audience). Falls back to the one-shot view under `--json` or when piped.
- **`--cloud`** mirrors Run B's denied `http:post` to a hosted AIM dashboard using the operator's `aim-sdk login` session: reads `~/.aim/sdk_credentials.json`, registers `dvaa-ragbot-aim` (with DVAA's own Ed25519 key) via `GET`/`POST /api/v1/agents`, and posts a signed verification. Registration sends the full hosted-backend shape (`name`, `displayName`, `description`, `agentType`, `publicKey`); the hosted API rejects a subset with HTTP 500. Best-effort and offline-safe: not logged in or backend unreachable falls back to the local-only demo. Verified end-to-end against `api.aim.opena2a.org` (event recorded with `result: verified`). New `src/aim-cloud-register.js`.
- **Run script** `docs/demo/RUN_SCRIPT.md`: operator runbook (pre-flight, beat-by-beat narration, reset, timing, failure fallbacks, teardown, optional cloud follow-on).

### Tests

- `test/aim-trust-behavioral.test.js` (NEW): denied action drops trust, allowed action does not, score is floored.
- `test/aim-cloud-register.test.js` (NEW): credential parsing, API-base resolution, register/load-from-cache contract, 401 handling, and the `isSafeApiBase` token-destination guard, against a mock backend.
- `test/telemetry-offline.test.js` (NEW): the demo and `--offline` produce zero telemetry posts (verified against a mock endpoint), while a normal command still posts and an explicit opt-in re-enables it.

## 0.9.1

### Fixed - UX papercuts from the 0.9.0 release-test

Drains the three "Known issues will fix in 0.9.1" items from 0.9.0's CHANGELOG. Two of them lived in `@opena2a/cli-ui` and were fixed at root (cli-ui 0.5.1); one was local to `src/browse.js`.

- **`dvaa telemetry --help`** now prints a proper usage block (actions, per-invocation override `OPENA2A_TELEMETRY=off`, debug knob `OPENA2A_TELEMETRY_DEBUG=print`). Previously fell into the cli-ui `Unknown action` default branch and printed `Unknown action '--help'. Try 'dvaa telemetry [on|off|status]'.`. Root-cause fix in `@opena2a/cli-ui@0.5.1` `runTelemetryCommand`; consumed here by bumping the pin.
- **`dvaa telemetry status`** toggle hint now flips based on current state - suggests `off` + `OPENA2A_TELEMETRY=off` when telemetry is on, suggests `on` + `OPENA2A_TELEMETRY=on` when telemetry is off. Previously always suggested `off`, which was useless when telemetry was already off. Root-cause fix in `@opena2a/cli-ui@0.5.1` `renderStatus`.
- **`dvaa browse --help`** now prints a browse-specific usage block (target arg, `--agents`, `--categories`, `--json`, `--publish`, `--verbose`) instead of falling back to the root `dvaa --help`. Root cause: `src/index.js`'s global `--help` check ran before the `browse` handler. Reordered so the `browse` subprocess spawn happens first, then `src/browse.js` checks `--help`/`-h` and prints its own usage. Subcommand-dispatched commands (`chat`, `demo`, `telemetry`, etc.) already had this property via `dispatch()`; only `browse` was special-cased.

### Changed - dependencies

- Bumped `@opena2a/cli-ui` pin from `0.4.0` to `0.5.1`. 0.5.0 (rich-context check block primitives, 2026-05-09) was a feature release we hadn't picked up yet; 0.5.1 (this release-test fixes) is what 0.9.1 actually needs. No DVAA code depends on 0.5.0's new exports.

### Tests

- `test/browse-help.test.js` (NEW): 3 subprocess tests asserting `--help` exits 0 + prints browse-specific text + does NOT leak root help (the exact bug class). Locks the fix in so a future index.js refactor can't reintroduce the regression.

### Honest scope

This release ships only the UX papercuts from 0.9.0's release-test. No new agents, no new commands, no AIM behavior change. RAGBot-AIM and ResearchBot-AIM enforcement contracts are unchanged.

## 0.9.0

### Added - AIM A/B demo

- **RAGBot-AIM**, the 15th agent (#42). Same code as RAGBot, with `aimEnforced: true` and capability grant `rag:read + chat:respond`. The shared `generateResponse()` consults `agent.aimEnforced` at one point only - just before the outbound `submit_to_index` tool call - so the AIM-enforced path is byte-identical to the vulnerable path except for the one `maybeEnforce()` check.
- **`dvaa demo aim-ab`** runner (#42). Deterministic A/B against the AgentPwn `APWN-DE-003` URL-exfiltration payload. Stands up a one-shot canary listener, POSTs the same poisoned document to RAGBot and to RAGBot-AIM, and prints a presenter-friendly comparison. Exit 0 = PASS (injection landed on both, Run A executed the exfil, Run B was denied by AIM). Useful as a stage demo AND a CI regression gate. Backed by `@opena2a/aim-core@0.2.0`; local Ed25519 identity, JSON-lines audit log, capability policy, and trust score all stored under `<DVAA_AIM_DATA_DIR or .dvaa-aim>/<agent.id>/`. No server, no API key, no network beyond the canary.
- **Cloud-mode reporter** (#44). Optional fire-and-forget mirror of each AIM enforcement decision to a registered AIM server. The local enforcement decision remains authoritative; the cloud post is best-effort. Ed25519-signed POST to `/api/v1/sdk-api/verifications`, matching the Python `aim-sdk@1.21.0` `verify_capability` wire format. Set `AIM_SERVER_URL` + `DVAA_AIM_CLOUD_AGENT_ID` to enable; `docs/demo/setup-aim-local.sh` brings up the 4-service local stack and registers the agent.

### Added - Interactive research-agent demo

- **ResearchBot + ResearchBot-AIM pair** (#45). Conversational variant of the AIM demo on ports 7015 / 7016. Same code, single variable (capability grant). ResearchBot-AIM's grant is `web:read + chat:respond`; the post-injection `http:post` callback is denied at the tool boundary while the injection still lands in context. Matches the RAGBot pair's "same agent, one variable" pattern.
- **`web_fetch` tool with SSRF guard** (#45). HTTPS GET + redirect follow + HTML text extraction. The guard refuses loopback / RFC1918 / link-local / cloud-metadata / non-http(s) by default and re-validates on every redirect hop. `DVAA_ALLOW_INTERNAL_FETCH=1` bypasses for offline-stage testing against local fixtures. Sha256-keyed cache under `.dvaa-aim/research-cache/` for stage fallback when live agentpwn.com is unreachable.
- **`dvaa chat <agent>`** REPL (#45). Readline-based interactive chat against a running fleet agent. `--message "..."` one-shot for asciinema + CI smoke. `dvaa chat list` prints all api agents with their port + AIM status. Pretty-prints `tool_calls` and the `dvaa` metadata (AIM enforcement, web_fetch source, http_post result).

### Added - LLM-mode narration

- **`dvaa chat --llm`** (#47). Opt-in LLM mode for the research-agent narration. The deterministic web_fetch path is unchanged - `web_fetch` still fires real tool calls, injection detection runs, AIM enforcement runs, and the optional `http_post` still fires (or is denied) exactly as before. Only the natural-language `content` field is sourced differently: with `--llm`, the agent reasons about the same tool report in fresh prose; without it, the existing byte-deterministic template renders. `tool_calls` and `dvaa` metadata are byte-identical across modes.
- **No-overclaim rule encoded in the prompt** (#47). The AIM-variant system prompt explicitly instructs the model not to overclaim AIM's scope - it must say "AIM denied the outbound `http_post` call because `http:post` is outside the grant" rather than "AIM blocked the attack." Live-tested against `agentpwn.com/attacks/data-exfiltration/3`: narration cites the denial reason verbatim and acknowledges "AIM did not filter it out - but the outbound action did not fire."
- **Loopback guard on `--llm`** (#47). `--llm` reads `ANTHROPIC_API_KEY` from the environment and POSTs it to the fleet's `/api/llm/configure` endpoint on port 9000. If `--host` is non-loopback, the guard refuses by default. To opt in, `DVAA_ALLOW_REMOTE_LLM_CONFIGURE` must name the **exact host value** - a bare `=1` is refused so a stale env var from one shell session can't accidentally apply to a different `--host`. `DVAA_DEBUG=1` surfaces LLM fallback errors on stderr.
- **Silent fallback**: LLM call failures (no key, timeout, network error, empty response) fall back to the deterministic template. The demo never hard-fails because of an unreachable API.

### Changed

- Description updated from "14 agents" to "17 agents" (matches the actual fleet: 11 api + 4 mcp + 2 a2a).

### Fixed - packaging

- **`.npmignore` added.** Previous releases shipped the local `.pre-push-review-passed` marker (0.8.2 visible on npm). With the new research-agent runtime state under `.dvaa-aim/` (Ed25519 identities including private keys, JSON-lines audit logs, web_fetch cache), an unguarded `npm pack` would forward developer-machine state - including the maintainer's secret key - into the published tarball. The `.npmignore` excludes `.dvaa-aim/`, the pre-push / release-test markers, `test/`, `.tgz` artifacts, `CLAUDE.md` / `.claude/` and other editor configs, `STATUS.md`, and `.github/` workflow YAML. Verified clean: 0.9.0 tarball ships 456 files vs 458 in 0.8.2 (smaller despite adding the research-agent surface, because runtime state + marker files + CI configs are no longer shipped).

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
- Subcommand telemetry events (`dvaa agents`, `dvaa scan`, etc.) were silently lost because the dispatcher fired `tele.track()` and immediately called `process.exit()`, killing Node before the HTTP request flushed. Discovered during prod canary verification - the curl probe landed in the Registry but the actual CLI did not. Fix: bump to `@opena2a/telemetry@0.1.2` (adds `flush()` and a `beforeExit` drain) and `await tele.flush()` in the dispatcher before exit. Per-event 2s timeout unchanged - `dvaa <cmd>` never hangs longer than that.

### Note
- v0.8.1 was tagged but the npm publish failed (Trusted Publisher not yet configured for `damn-vulnerable-ai-agent`). v0.8.2 supersedes it; users should install 0.8.2 directly.

## 0.8.1

### Added
- Tier-1 anonymous usage telemetry via `@opena2a/telemetry`: `dvaa --version` shows the disclosure line; `dvaa telemetry [on|off|status]` subcommand inspects and toggles. Disable per-invocation with `OPENA2A_TELEMETRY=off`, persistently with `dvaa telemetry off`, audit payloads with `OPENA2A_TELEMETRY_DEBUG=print`. README §Telemetry documents the full schema and the [opena2a.org/telemetry](https://opena2a.org/telemetry) policy page.
- `release-smoke.md` §7 covers the seven telemetry checks (--version, status, off-persist, on-persist, env-off override, debug-print, network-failure tolerance).

### Behaviour
- Default state is ON. Spec rationale: matches industry norm (npm, Docker Desktop, VS Code, Homebrew) for anonymous install counts. Opt-out is one env var or one subcommand.
- No first-run banner - disclosure is discoverable via README + `--version` + `dvaa telemetry` + the policy page (per spec amendment 2026-04-27).
- No content collection. The schema is locked at 10 fields (tool, version, install_id, event, name, success, duration_ms, platform, node_major, country_code) and any expansion requires a new spec amendment + Registry migration.
- Telemetry is fire-and-forget; 2s timeout; network failures never block the CLI.
