# Run script — `dvaa demo flight`

A relatable, three-act demo of AIM capability enforcement: a flight-booking
agent holding a synthetic traveler wallet is compromised by an indirect prompt
injection, then the same agent code under an AIM grant blocks the exact same
attack. Designed to be venue-neutral and reusable at any talk.

## One-command start

```
dvaa demo flight            # full run on one screen
dvaa demo flight -i         # step through the three acts with pauses (live audience)
dvaa demo flight --json     # machine-readable verdict (CI / scripting)
```

No pre-flight. The command stands up its own isolated fleet, seeds a
deterministic poisoned page, runs the acts over the agents' real HTTP API, and
tears the fleet down. It is offline by default — nothing leaves the machine
except onto a local canary you control.

If ports 7017/7018 are already in use by a developer fleet (`dvaa --api`), stop
that first — the demo manages its own fleet so it never drives someone else's
agents.

## The three acts (what to say)

**Act 1 — a trustworthy booking agent.**
> "Here's a normal flight agent. I ask it to find flights LAX to JFK and it does
> exactly that."

It returns a short itinerary list. Nothing suspicious; build the audience's
trust in the agent first.

**Act 2 — the unprotected agent is compromised.**
> "Now I ask it to check a deals page for something cheaper. That page is
> poisoned — it carries hidden instructions for AI agents. The agent reads them,
> pulls up the traveler's saved wallet, and sends it to an attacker."

Point at the `EXFILTRATED` line and the canary hit: the wallet — cards, email,
passport, loyalty numbers — just left the agent. (All values are public test
data: card `4242 4242 4242 4242`, `@example.com`, everything tagged FAKE. Say so
if anyone asks; the point is the *mechanism*, not the data.)

**Act 3 — the same agent, bound to AIM.**
> "Same agent code. The only change: I install the SDK and log in, which binds
> the agent to an AIM identity with a capability grant. I run the exact same
> attack."

```
pip install <sdk>        # the audience's path to the protected agent
aim-sdk login            # binds the secured agent to their account
```

Point at the `BLOCKED` line: the injection still landed in the agent's context —
AIM does not filter inputs — but the outbound `http:post` is outside the agent's
grant, so it is denied at the egress boundary. The wallet never leaves, and the
agent's trust score drops because of the recorded denial.

> "The capability grant, not an input filter, is what contained the attack."

## Public proof (optional)

```
dvaa demo flight --live
```

With `--live` the agent fetches the real agentpwn.com deals page (instead of the
seeded offline copy) and exfiltrates the synthetic wallet to agentpwn's live
canary, which increments the public counters at agentpwn.com/stats. Use only on
a trusted network; the offline default is the reliable stage path.

The trap is key-scoped to this demo: the agentpwn page only serves its injection
when fetched with the demo key, so an unrelated agent that merely browses the
deals page is never induced to leak its own data.

For an independently reviewable record, commit the run's capture to the public
captures repo. No credentials are embedded in the tool, so the timestamp and
history are verifiable on GitHub:

```
git clone https://github.com/opena2a-org/dvaa-demo-captures
cd dvaa-demo-captures
npx dvaa demo flight --live --json | ./record.sh
git add -A && git commit -m "capture $(date -u +%FT%TZ)" && git push
```

Because the trap is locked, the only data that can ever appear there is the
demo's own synthetic wallet.

## Reset between runs

Each run uses a fresh ephemeral data dir, so there is nothing to reset — just run
the command again. The trust-score drop in Act 3 is per-run (it lives in the
ephemeral agent audit log).

## Customizing for your venue

| Knob | Env var | Default |
|------|---------|---------|
| Agent display name | `DVAA_AGENT_NAME` | `FlightBot` |
| Target deals URL (base) | `DVAA_FLIGHT_URL` | `https://agentpwn.com/deals/cheap-flights` |
| Demo key (gates the live injection) | `DVAA_FLIGHT_DEMO_KEY` | `dvaa-flight-demo` |
| Live stats URL | `DVAA_STATS_URL` | `https://agentpwn.com/stats` |
| Agent ports | `DVAA_FLIGHT_PORT` / `DVAA_FLIGHT_AIM_PORT` | `7017` / `7018` |

## If something goes wrong on stage

- **"Ports already in use"** — a fleet is running; stop it (`pkill -f 'index.js --api'`) and re-run.
- **Act 2 shows "no exfil observed"** — the seeded page didn't load; re-run (the seed is per-run). Check you're not in `--live` on a dead network.
- **Act 3 shows "not blocked"** — confirm `AIM_ENFORCEMENT` is not set to `off` in your shell.
- Fall back to `--json` and read the verdict fields aloud if the terminal rendering misbehaves.
