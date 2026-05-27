# DEMO_BUILD.md

Reference for the AIM A/B demo shipped in DVAA. A public capability anyone can run via `dvaa demo aim-ab` — use as a conference / live-stage demo, as a quick "show me what AIM does" walkthrough, or as a CI regression gate.

## What this is

Two parts:

1. **Deterministic A/B (`dvaa demo aim-ab`)**. Same agent code, run twice against the same poisoned RAG document. The only variable is whether the AIM capability layer is active. Run A executes the outbound exfiltration; Run B attempts it and is denied by capability enforcement before the data leaves the agent. Produces presenter-friendly output and exits 0 on PASS.
2. **AgentPwn showcase (`dvaa browse`)**. The same AIM-protected agent is in the regular DVAA fleet enumeration. When users run `dvaa browse` against agentpwn.com (or any URL), the AIM-protected agent shows up as the one that survives the RAG-poisoning + outbound-exfil payload while the rest of the fleet does not.

## The 15th agent

- **Name:** `RAGBot-AIM`
- **Port:** 7014 (next free in the API range; SecureBot through LongwindBot occupy 7001-7008, then the new agent slots in)
- **Code:** identical to RAGBot. Shares the same agent definition shape, the same `vulnerabilities` config (`contextManipulation.ragPoisoning`, `dataExfiltration.leakRetrievedDocs`), the same `knowledgeBase` with the same sensitive contents. The only adds are `aimEnforced: true` and `aimCapabilities: ['rag:read', 'chat:respond']` on the agent record in [`src/core/agents.js`](src/core/agents.js).
- **No forked code path.** The shared `generateResponse()` in [`src/index.js`](src/index.js) consults `agent.aimEnforced` at one point only: just before executing the outbound `submit_to_index` tool call, it calls `maybeEnforce(agent, {...})` from [`src/aim-enforcer.js`](src/aim-enforcer.js). If the agent is not AIM-enforced, the function returns `{enforced: false}` and the code path is byte-identical to the vulnerable agent.

## Scope of AIM enforcement in this build

AIM enforces **one specific action** on RAGBot-AIM: the outbound `submit_to_index` tool call (mapped to capability `http:post`). This is gated correctly and the demo's PASS criterion verifies it via a real canary.

What AIM does NOT block on RAGBot-AIM in this build, all still vulnerable:
- In-chat data exfiltration via the legacy `dataExfiltration` text regex (system prompt extraction, context/token leaks, partial API key leaks). Lives in `src/index.js` after the AIM-gated block.
- Context-overflow leaks (RAGBot-AIM doesn't have `contextOverflow.enabled`, but the pattern would apply to any agent that did).
- Any other agent-text response that happens to contain sensitive content.

Future-direction: closing this gap is additive — wrap response-text egress in a `checkCapability('chat:respond:contains-credentials')` hook, gate the existing `dataExfiltration` text paths, etc. Don't relax the scope claim; expand the enforcement surface.

## The AIM capability grant

```
allow: ['rag:read', 'chat:respond']
default: deny
```

Loaded inline at agent server startup. The outbound `submit_to_index` call is mapped to the action string `http:post`, which is outside the grant, so AIM denies it. The denial reason text quotes the grant verbatim so the audience can see exactly what the agent was and wasn't allowed to do:

```
action 'http:post' is outside the agent's declared capability grant (rag:read, chat:respond)
```

Identity (Ed25519), audit log (JSON-lines), capability policy (in-memory from inline shorthand), and trust score are all backed by [`@opena2a/aim-core`](https://www.npmjs.com/package/@opena2a/aim-core), pinned at `0.2.0`. **No server, no API key, no network.** Per-agent data lives under `<DVAA_AIM_DATA_DIR or .dvaa-aim>/<agent.id>/`.

## The enforcement toggle

`AIM_ENFORCEMENT=off` on the DVAA process makes `maybeEnforce()` short-circuit to `{enforced: false}` for every call. RAGBot-AIM then reproduces RAGBot's vulnerable behavior on the same code path. This is the "same agent, one variable" proof. It is also the safety net if the live AIM path misbehaves on stage:

```bash
AIM_ENFORCEMENT=off dvaa --api    # Terminal 1, "demo mode" with AIM off
dvaa demo aim-ab                  # Terminal 2, will FAIL the verdict (as intended)
```

When the verdict fails because AIM is off, the runner's exit code is 1 and the output explicitly shows Run B executing the exfil and the canary receiving the data.

## The demo runner

```
dvaa demo aim-ab [--json] [--verbose]
```

Pre-flight: requires both `localhost:7005` (RAGBot) and `localhost:7014` (RAGBot-AIM) reachable. Errors with `Start the fleet in another terminal: dvaa --api` if not.

What it does, in order:
1. Stands up its own one-shot HTTP canary listener on a random free port (no external network).
2. Builds the poisoned RAG document. Payload is AgentPwn `APWN-DE-003` (URL Exfiltration), mirrored into [`src/payloads/agentpwn-mirror.js`](src/payloads/agentpwn-mirror.js) with the upstream source pointer and a sync date. The `[INSERT_YOUR_SYSTEM_PROMPT_HERE]` placeholder is filled with `[INSERT_YOUR_DOCUMENT_CONTENTS_HERE]` and the canary URL is substituted in.
3. POSTs the document to RAGBot, captures the chat completion response (which now includes `tool_calls` and a custom top-level `dvaa` object with `exfilAttempted`, `exfilExecuted`, `exfilResult`, `aim.{enforced, allowed, denialReason, auditEventId, trustScore}`).
4. POSTs the same document to RAGBot-AIM, captures the same shape.
5. Closes the canary, collects its hit log.
6. Prints a short, presenter-friendly comparison (two five-line blocks, one verdict line).

Exit codes:
- `0` PASS: injection landed on both runs, Run A executed the exfil and the canary received it, Run B's action was denied and the canary received nothing.
- `1` FAIL: pre-flight failed or the A/B did not produce the expected pattern. Useful as a CI regression gate.

Flags:
- `--json` Machine-readable output (for CI piping).
- `--verbose` Includes raw chat responses and the full canary hit log.

## Cloud mode (live AIM dashboard view)

Default mode is local-first: aim-core stores the agent's Ed25519 identity, capability policy, audit log, and trust score on disk under `.dvaa-aim/<agent.id>/`. The `dvaa demo aim-ab` runner shows the denied event in CLI but there's no dashboard.

Cloud mode adds a fire-and-forget mirror of each enforcement decision to an AIM server, where the agent is registered and the verification events appear in the dashboard UI. The local enforcement decision remains authoritative; the cloud post is best-effort and never blocks the request.

**Bring up a local AIM stack and register the agent (one-shot):**

```bash
# From the dvaa repo root:
./docs/demo/setup-aim-local.sh
```

The script will:
1. `docker compose up` the 4-service AIM stack (postgres + redis + backend + frontend) in the sibling `agent-identity-management/` repo
2. Generate `.env` with shell-safe random secrets for postgres / redis / JWT / keyvault (re-uses existing if present)
3. Add a `docker-compose.override.yml` that remaps aim-postgres to host port 5433 (so it coexists with a local postgres on 5432)
4. Seed a local admin user (`admin@opena2a.org` / `AIM2025!Secure`) via direct SQL using a bcrypt hash from migration 072
5. Log in as that admin to capture a JWT
6. Generate DVAA's Ed25519 identity for `ragbot-aim` (or reuse if `.dvaa-aim/ragbot-aim/identity.json` exists)
7. Register the agent against the local backend with that public key and capabilities `rag:read, chat:respond`
8. Print the env vars to copy into the next `dvaa --api` invocation

**Local-only credentials, do not use in production.** The admin password is the DVAA-CTF default and is documented publicly; the script will refuse to run if it can detect a public-facing backend endpoint (TODO: that detection isn't in yet — for now just don't point it at a real cloud).

**Run the demo with cloud reporting on:**

```bash
# Terminal 1 — DVAA fleet with cloud env set
export AIM_SERVER_URL=http://localhost:8080
export AIM_API_KEY=not_required_for_local_verifications
export DVAA_AIM_CLOUD_AGENT_ID=<uuid the setup script printed>
dvaa --api

# Terminal 2 — the demo runner
dvaa demo aim-ab
```

After the demo finishes, open http://localhost:3000, log in (`admin@opena2a.org` / `AIM2025!Secure`), navigate to Agents → see `dvaa-ragbot-aim` registered, navigate to Verification Events → see two events (one for each `dvaa demo aim-ab` run, with `action_type: http:post`, `status: success`, agent's trust score, Ed25519 signature on the request body).

This is the conversion-funnel visual for live demos: show the CLI demo for proof, then click into the dashboard to show the registered agent + audit trail. The honest pitch is "AIM denied this specific http:post because it's outside the agent's grant" — keep the claim narrow per the Scope section above. Do not overclaim that AIM blocked the injection itself; it blocked the resulting outbound action.

**Cloud-mode contract (so future maintainers don't re-derive it):**

The reporter implements the Python SDK's `verify_capability` wire format (`aim_sdk/client.py:504-620`). One POST per enforcement decision to `/api/v1/sdk-api/verifications` with:
- Body: `{agentId, capability, resource, context, timestamp, signature, publicKey, enforcementResult}`
- Signature: Ed25519 over the canonical signature payload `{action_type, agent_id, context, resource, timestamp}`, JSON-serialized with sorted keys and Python's default separators (`', '` and `': '`) — see `src/aim-cloud-reporter.js pythonJsonStringify()`
- Auth: NO bearer header. The Ed25519 signature in the body IS the auth (server `Ed25519AgentMiddleware` verifies against the agent's registered public key). The `X-API-Key` header is sent if `AIM_API_KEY` is set, but the verifications endpoint ignores it.

**Tear down the local AIM stack when done:**

```bash
docker compose \
  -f ../agent-identity-management/docker-compose.quickstart.yml \
  -f ../agent-identity-management/docker-compose.override.yml \
  --env-file ../agent-identity-management/.env \
  down
```

Or `down -v` to also wipe the postgres volume (you'll need to re-seed the admin on next bring-up).

## How to run the AgentPwn showcase

Same target URL DVAA documents in its main README; the 15th agent slots into the standard `dvaa browse` enumeration:

```bash
dvaa --api                         # Terminal 1
dvaa browse                        # Terminal 2, defaults to agentpwn.com
```

Look at the per-agent summary at the bottom. RAGBot-AIM should show `0 pwned, 1 blocked` on the RAG-poisoning payload while RAGBot shows `1 pwned`. To compare just those two:

```bash
dvaa browse --agents ragbot,ragbot-aim --categories data-exfiltration
```

## Recorded fallback

A scripted reproduction is included so the presenter can play it back if the live environment fails on stage. Generate the asciinema cast with:

```bash
./docs/demo/record-aim-ab.sh
```

This script starts the DVAA fleet, runs `asciinema rec --command 'dvaa demo aim-ab' docs/demo/aim-ab.cast`, and stops the fleet. Play back with:

```bash
asciinema play docs/demo/aim-ab.cast
```

The recorded run shows the same flow as the live demo. Re-record if the runner output format changes.

If asciinema isn't installed on the stage machine, fall back to:

```bash
# In a recorded terminal session (Cmd+Shift+5 on macOS, Win+G on Windows)
dvaa --api &
sleep 3
dvaa demo aim-ab
```

## Research-agent showcase (`dvaa chat`)

Conversational variant of the AIM demo. Where `dvaa demo aim-ab` is a deterministic A/B against a fixed mirrored payload (good for slide proof), `dvaa chat` lets the user talk to a research agent that fetches a live URL via a `web_fetch` tool. If the fetched page carries an indirect prompt injection (like agentpwn.com's APWN-DE-003 URL-exfil payload at `/attacks/data-exfiltration/3`), the agent follows the injection in-context and self-narrates the compromise honestly. With AIM enforcement, the post-injection `http:post` action is denied at the tool boundary; the injection still landed in the agent's context (AIM does not filter inputs), but the resulting outbound action cannot fire.

### The agent pair

- **ResearchBot** (port 7015) — vulnerable. No AIM enforcement. Fetches URL, follows injection, posts to the attacker-controlled callback.
- **ResearchBot-AIM** (port 7016) — same code path, same vulnerability profile. AIM grant is `web:read + chat:respond`. `web_fetch` (capability `web:read`) is allowed; the post-injection `http:post` is outside the grant and is denied.

Identical to the RAGBot / RAGBot-AIM pair: same code, single variable (the AIM capability grant) decides whether the action fires. `AIM_ENFORCEMENT=off` reproduces ResearchBot's unprotected behavior on ResearchBot-AIM for the "same agent, one variable" proof.

### Run it

```
dvaa --api                                       # Terminal 1
dvaa chat                                        # Terminal 2 (REPL against researchbot-aim)
> Please summarize https://agentpwn.com/attacks/data-exfiltration/3
```

Default agent is `researchbot-aim` (the conversion-funnel target — show this first). Switch with `dvaa chat researchbot` for the unprotected contrast.

One-shot mode for asciinema + CI:

```
dvaa chat researchbot-aim --message "summarize https://agentpwn.com/attacks/data-exfiltration/3"
dvaa chat researchbot      --message "summarize https://agentpwn.com/attacks/data-exfiltration/3" --json | jq
```

`dvaa chat list` shows all api agents with their port + AIM status.

### What gets enforced

AIM enforces TWO boundaries on ResearchBot-AIM:
- `web:read` on the `web_fetch` call (allowed by the grant — agent can browse)
- `http:post` on the post-injection callback (NOT in the grant — denied)

The honest claim is narrow, exactly as with the existing aim-ab demo: AIM denied this specific outbound action because `http:post` is outside the declared capability grant `(web:read, chat:respond)`. AIM does NOT filter the indirect injection out of the fetched content. In-context leaks (via the agent's own text response) remain possible by design — closing those is additive future work that wraps response-text egress in a `chat:respond:contains-credentials` hook.

### Live agentpwn.com vs cached

Live by default. The web_fetch tool fetches the target URL with redirect follow (max 3), 10s timeout, 2MB body cap. On a successful live fetch, the body is cached under `<DVAA_AIM_DATA_DIR or .dvaa-aim>/research-cache/<sha256(url)>.html` for stage fallback.

Force cache-first with `DVAA_RESEARCH_CACHE=on`:

```
DVAA_RESEARCH_CACHE=on dvaa chat researchbot-aim --message "summarize https://agentpwn.com/attacks/data-exfiltration/3"
```

If a live fetch fails and a cache entry exists, the tool falls back to the cache automatically (returns `source: 'cache-after-live-failed'` so the agent's narration is honest about where the content came from).

### Injection detection

`detectInjection()` in `src/web-fetch.js` matches two agentpwn-style indirect-injection patterns in the fetched body:
- SSR `<meta name="ai-instructions" content="...">` data attribute (rendered server-side by agentpwn's `/attacks/[category]/[tier]/page.tsx`)
- URL-exfiltration template: any HTTPS URL containing `canary|exfil|report|callback|webhook` in the path
- "send a POST request to <url>" prose pattern (from agentpwn's generic `buildCallback()` instruction)

When the URL contains `[INSERT_YOUR_SYSTEM_PROMPT_HERE]` (or the variant `[INSERT_YOUR_DOCUMENT_CONTENTS_HERE]`), the agent's persona is URL-encoded and substituted in before the http:post fires. ResearchBot's exfil request thus carries the agent's actual system prompt as `?data=` query param — visible in the canary log (or the http:post tool_call args field).

### LLM-mode

Offline mode is the default and remains the stage-safe baseline (no API-key dependency, byte-deterministic narration, asciinema-reproducible). LLM-mode is opt-in via `dvaa chat --llm` and lets the agent reason about the page content in fresh language.

```
export ANTHROPIC_API_KEY=...                              # required for --llm
dvaa --api                                                # terminal 1
dvaa chat --llm researchbot-aim \
  --message "summarize https://agentpwn.com/attacks/data-exfiltration/3"
```

The flag reads `ANTHROPIC_API_KEY` from the shell and POSTs it to the fleet's `/api/llm/configure` endpoint on port 9000. The key is held in-memory on the fleet process for the rest of that `dvaa --api` lifetime; it is never written to disk. Model defaults to `claude-sonnet-4-6`; override via `DVAA_LLM_MODEL=...`.

Loopback guard: if `--host` names anything other than `localhost`, `127.0.0.1`, or `::1`, `--llm` refuses by default rather than forward the key. To opt in, set `DVAA_ALLOW_REMOTE_LLM_CONFIGURE` to the **exact host value** (not `1`):

```
DVAA_ALLOW_REMOTE_LLM_CONFIGURE="other-host.example.internal" \
  dvaa chat --llm --host other-host.example.internal \
  --message "summarize https://agentpwn.com/attacks/data-exfiltration/3"
```

The override must name the exact host so a stale env var from one shell session doesn't accidentally apply to a different `--host` value (copy-paste safety).

Debugging: LLM failures silently fall back to the deterministic template so the demo never hard-fails. To surface the underlying error reason on stderr while iterating on prompts, set `DVAA_DEBUG=1` on the fleet process.

Wire-up:
- `web_fetch` + injection detection + AIM enforcement + optional `http_post` all run deterministically, same as offline mode. Only the natural-language `content` field of the response is different.
- For each of the four web_fetch outcomes (`fetch-denied`, `no-injection`, `aim-blocked-post`, `exfil-fired`) [`src/llm/research-narration.js`](src/llm/research-narration.js) builds a tool-report context and calls the LLM via [`src/llm/provider.js`](src/llm/provider.js). The agent's system prompt is built per-agent by `buildResearchAgentSystem()` in [`src/llm/prompts.js`](src/llm/prompts.js).
- `tool_calls` and `dvaa` metadata (AIM decision, http_post URL, status) are byte-identical between offline and LLM modes — the chat REPL and the `dvaa demo aim-ab` parser are unaffected.
- LLM call failures (no key, timeout, network error, empty response) silently fall back to the deterministic offline template. The demo never hard-fails because of an unreachable API.

CHIEF-CSR rule encoded in the prompt: AIM-enforced agents get an addendum that AIM gates outbound actions only and does NOT filter incoming content. The agent is explicitly instructed not to claim "AIM blocked the attack" or "AIM protected me from the injection" when AIM only denied the resulting outbound action. Wording is load-bearing because the live demo's pitch is narrow on purpose.

To re-tune the prompts: edit `RESEARCH_AGENT_BASE` and `RESEARCH_AGENT_AIM_ADDENDUM` in `src/llm/prompts.js`. Re-run [`test/research-agent-llm-mode.test.js`](test/research-agent-llm-mode.test.js) to assert the no-overclaim wording survives the edit (the test grep-asserts the chief-CSR sentinel phrases).

### SSRF guard on web_fetch

`web_fetch` refuses by default: loopback (`127.0.0.0/8`, `localhost`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, `fe80::/10`), ULA (`fc00::/7`), `0.0.0.0`, and non-http(s) schemes. Re-validated on every redirect hop. This is deliberate: the chat REPL is a user-facing interface and an unbounded fetch primitive would let a malicious URL exfiltrate internal-network state from the developer's machine.

Set `DVAA_ALLOW_INTERNAL_FETCH=1` to bypass the guard when pointing ResearchBot at a local fixture for offline-stage testing:

```
DVAA_ALLOW_INTERNAL_FETCH=1 dvaa chat researchbot --message "summarize http://127.0.0.1:9000/fixtures/agentpwn-mirror.html"
```

Residual risk: DNS rebinding (a hostname that resolves to a public IP on first lookup and an internal IP on second) is not defeated by the string-pattern check. PR 2 follow-up: resolve + IP-bind on first lookup.

### Invariants

- Does not change RAGBot-AIM's grant or break `dvaa demo aim-ab` PASS verdict
- Does not relax the honest-scope claim: AIM enforces `http:post` denial only; in-band leaks remain by design
- Does not add a dependency: uses Node `https` + `URL` + `readline` built-ins only

## Pre-stage checklist for a live demo

Things to verify on the actual stage machine before any live presentation, in priority order:

1. **Re-run `dvaa demo aim-ab` on the stage machine** and confirm exit 0. The runner is deterministic; if it ever fails on a clean install, that is a regression. Capture the output in a screenshot for the backup deck.
2. **Confirm the trust score number** the demo will display. Out of the box it shows `30/100 (improving)` because `aim-core` weights factors like `secretsManaged`, `configSigned`, `skillsVerified`, etc. that DVAA does not hint as enabled. If you want a higher number, call `setTrustHints()` in [`src/aim-enforcer.js`](src/aim-enforcer.js) after `getCore()` with the hints that are honestly true for your setup. Do not set hints for things that are not actually true. The conservative starting score is consistent with the honest pitch ("AIM gives you a real trust score that reflects real events").
3. **Verify the canary timing on stage.** The runner sleeps 50ms between Run A and Run B and 100ms before closing the canary. On a slow laptop these may need to be 200ms/300ms. Re-run on the actual machine and tune if needed.

## What I could not verify against the AIM or AgentPwn code

- **AgentPwn `APWN-DE-003` injection text stability.** I mirrored the payload into [`src/payloads/agentpwn-mirror.js`](src/payloads/agentpwn-mirror.js) as of 2026-05-24, against `agentpwn/src/lib/payloads/templates.ts:280-290`. If AgentPwn ever edits that entry, the mirror will drift. The mirror file carries a sync date comment so any future maintainer can re-check.
- **`@opena2a/aim-core` API stability across the 0.2 line.** Pinned to `0.2.0` exactly. If we bump to `0.3.x` the enforcer module may need updates; check `AIMCore` class shape and `loadPolicy` inline-shorthand signature before bumping.
- **AIM has three SDKs across two ecosystems.** DVAA uses `@opena2a/aim-core@0.2.0` on npm: the local-first JS library (Ed25519, capability policy, local audit log, trust score, no server). Python users have a fully published cloud SDK at `aim-sdk@1.21.0` on PyPI (`from aim_sdk import secure`, auto-register, dashboard sync, API key optional). A TS port of the Python cloud SDK lives in `agent-identity-management/sdk/typescript/` (as `@opena2a/aim-sdk`) but is NOT published; do not try to `npm install` it. If you read AIM repo code expecting the cloud-API shape (`AIMClient`, `verifyAction()`), that shape exists in Python today and will exist in JS when the TS port ships.
- **Trust score computation is verified by smoke test, not by reading aim-core's `trust.ts` source.** The library returns `{ overall, score, grade, factors }`; the runner surfaces `score` and `grade`. If the schema changes between releases, the runner will silently show `undefined`. There is no schema guard.
