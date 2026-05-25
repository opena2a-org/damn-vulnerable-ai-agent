# DEMO_BUILD.md

Reference for the AIM A/B demo shipped in DVAA. Used as the SVCC 2026 slide-20 demo and as a public capability anyone can run via `dvaa demo aim-ab`.

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

This is the SVCC conversion-funnel visual. Show the CLI demo for proof, then click into the dashboard to show the registered agent + audit trail. The talk pitch is "AIM denied this specific http:post because it's outside the agent's grant" — keep the claim narrow per the Scope section above.

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

## Pre-stage checklist for Abdel before SVCC

Things that need a human eye before June 11, in priority order:

1. **Re-run `dvaa demo aim-ab` on the stage machine** and confirm exit 0. The runner is deterministic; if it ever fails on a clean install, that is a regression. Capture the output in a screenshot for the backup deck.
2. **Confirm the trust score number** the demo will display on stage. Right now it shows `30/100 (improving)` because `aim-core` weights factors like `secretsManaged`, `configSigned`, `skillsVerified`, etc. that DVAA does not hint as enabled. If you want a higher number for the slide, call `setTrustHints()` in [`src/aim-enforcer.js`](src/aim-enforcer.js) after `getCore()` with the hints that are honestly true for DVAA's setup. Do not set hints for things that are not actually true.
3. **Decide if the recorded fallback should use a faked higher trust score** for stage readability. The honest answer is no: show the real number even if it is 30. The talk's claim is "AIM gives you a real trust score that reflects real events," and a conservative starting score is consistent with that.
4. **Verify the canary timing on stage.** The runner sleeps 50ms between Run A and Run B and 100ms before closing the canary. On a slow stage laptop these may need to be 200ms/300ms. Re-run on the actual machine and tune if needed.

## What I could not verify against the AIM or AgentPwn code

- **AgentPwn `APWN-DE-003` injection text stability.** I mirrored the payload into [`src/payloads/agentpwn-mirror.js`](src/payloads/agentpwn-mirror.js) as of 2026-05-24, against `agentpwn/src/lib/payloads/templates.ts:280-290`. If AgentPwn ever edits that entry, the mirror will drift. The mirror file carries a sync date comment so any future maintainer can re-check.
- **`@opena2a/aim-core` API stability across the 0.2 line.** Pinned to `0.2.0` exactly. If we bump to `0.3.x` the enforcer module may need updates; check `AIMCore` class shape and `loadPolicy` inline-shorthand signature before bumping.
- **AIM has three SDKs across two ecosystems.** DVAA uses `@opena2a/aim-core@0.2.0` on npm: the local-first JS library (Ed25519, capability policy, local audit log, trust score, no server). Python users have a fully published cloud SDK at `aim-sdk@1.21.0` on PyPI (`from aim_sdk import secure`, auto-register, dashboard sync, API key optional). A TS port of the Python cloud SDK lives in `agent-identity-management/sdk/typescript/` (as `@opena2a/aim-sdk`) but is NOT published; do not try to `npm install` it. If you read AIM repo code expecting the cloud-API shape (`AIMClient`, `verifyAction()`), that shape exists in Python today and will exist in JS when the TS port ships.
- **Trust score computation is verified by smoke test, not by reading aim-core's `trust.ts` source.** The library returns `{ overall, score, grade, factors }`; the runner surfaces `score` and `grade`. If the schema changes between releases, the runner will silently show `undefined`. There is no schema guard.
