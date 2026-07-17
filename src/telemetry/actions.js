/**
 * Which dashboard requests count as a deliberate user action.
 *
 * Why this exists: dvaa's documented happy path is `docker run`, whose CMD
 * passes no subcommand (Dockerfile:23). That takes the server path, which
 * reaches `tele.start()` (src/index.js:1806) and nothing else — the only
 * `tele.track` call lives in the CLI dispatcher (src/cli/router.js:63), which
 * `process.exit()`s before the server path is ever reached. So the majority of
 * installs emitted exactly one `start` event, on their boot day, forever.
 *
 * The Registry's `engaged` metric requires an install to be active on >= 2
 * distinct UTC days AND to have emitted >= 1 `command` event. Docker users could
 * satisfy neither. dvaa reported 177 monthly actives against 1 engaged user
 * while every other tool converted at 45-86%. The lab was being used; it just
 * never said so.
 *
 * This fixes the COMMAND half only, and that is worth being precise about.
 * install_id still churns across container recreation (no volume for
 * /home/node/.config/opena2a), so a user who runs `docker run` on Monday and
 * again on Tuesday is two install_ids of one day each and STILL is not engaged.
 * After this change, engaged becomes reachable for someone who keeps a single
 * container alive across >= 2 UTC days (compose's `restart: unless-stopped`) and
 * acts on both — not for the README's hero `docker run` flow. The 177 denominator
 * is inflated by that same churn.
 *
 * So expect this to move the number off 1, but do NOT read the result as a rate
 * comparable to the other CLIs' 45-86%. It is a floor until the identity churn
 * is fixed too.
 *
 * Two rules govern what goes in this list, and both matter more than coverage:
 *
 * 1. ONLY deliberate human actions. Never /health, never /stats. The container's
 *    own HEALTHCHECK polls /stats every 30 seconds (Dockerfile:21-22), so
 *    tracking it would mint a perfect engagement record for a container nobody
 *    has ever opened. That is not a metrics bug, it is fabrication: the number
 *    would look excellent and mean nothing.
 * 2. An allowlist, never a denylist. A new route is untracked until someone
 *    decides it represents a human doing something. Getting this backwards means
 *    the next polling endpoint silently starts manufacturing engagement.
 *
 * Deliberately NOT here: every GET (reads are how the UI polls), /health,
 * /stats, /api/attack-log, /api/scoreboard, /api/timer, the sandbox read
 * endpoints. None of them mean a person did anything.
 */

/**
 * Allowlist of user actions. `name` is what lands in the telemetry `command`
 * field — no paths, no ids, no content, just a stable label.
 */
const USER_ACTIONS = [
  // The core act: firing a payload at an agent in the Attack Lab. Since 0.9.2
  // the whole fleet is driven through the dashboard proxy, so this captures
  // single-port users too.
  { method: 'POST', pattern: /^\/api\/agents\/[^/]+\/chat$/, name: 'lab-chat' },
  // A CTF solve attempt — the strongest engagement signal dvaa has.
  { method: 'POST', pattern: /^\/api\/challenges\/[^/]+\/verify$/, name: 'lab-challenge-verify' },
  // Scan / remediate a scenario. Mirrors the `scan` subcommand, which IS tracked
  // on the CLI path.
  { method: 'POST', pattern: /^\/api\/scenarios\/[^/]+\/scan$/, name: 'lab-scan' },
  { method: 'POST', pattern: /^\/api\/scenarios\/[^/]+\/fix$/, name: 'lab-fix' },
  // Asking the tutor is a deliberate learning action.
  { method: 'POST', pattern: /^\/api\/tutor\/ask$/, name: 'lab-tutor-ask' },
  // Turning on a real LLM is high-intent setup.
  { method: 'POST', pattern: /^\/api\/llm\/configure$/, name: 'lab-llm-configure' },
  // Restarting the lab session.
  { method: 'POST', pattern: /^\/api\/reset$/, name: 'lab-reset' },
];

/** UTC day stamp, matching how the Registry buckets activity. */
function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The action name for a request, or null if it isn't a tracked user action.
 * @param {string} method
 * @param {string} pathname already parsed — never the raw URL, so a query
 *   string or fragment cannot smuggle a match
 * @returns {string|null}
 */
export function actionFor(method, pathname) {
  if (typeof method !== 'string' || typeof pathname !== 'string') return null;
  const hit = USER_ACTIONS.find((a) => a.method === method && a.pattern.test(pathname));
  return hit ? hit.name : null;
}

/**
 * Build the per-request tracker.
 *
 * Throttled to one event per action per UTC DAY — not per rolling hour.
 *
 * The day is not an arbitrary choice; it is the unit `engaged` actually counts
 * (`COUNT(DISTINCT date_trunc('day', received_at)) >= 2`). A rolling window is
 * subtly wrong here: with a one-hour throttle, a user acting at 23:59 and again
 * at 00:30 is genuinely active on two UTC days, but the second event is
 * suppressed and they report one. The throttle would hide precisely the users
 * this change exists to count. Keying on the UTC day cannot drop a day the
 * metric would have counted, and it still collapses a 100-payload burst into a
 * single event.
 *
 * The map is bounded by the allowlist size (one key per action), because the
 * value is the day rather than the key.
 *
 * Note there is deliberately NO heartbeat or timer anywhere. A periodic ping
 * would make an idle container look like an active user, which is the same
 * fabrication as tracking the HEALTHCHECK. An unused lab reporting nothing is
 * the correct answer, not a gap.
 *
 * @param {object} o
 * @param {(name: string, fields?: object) => unknown} o.track usually tele.track
 * @param {() => number} [o.now] injectable for tests
 * @returns {(method: string, pathname: string) => string|null} the action name
 *   if an event was ATTEMPTED, else null. Attempted, not delivered: the SDK
 *   drops events under its own debounce/in-flight caps, and that is deliberately
 *   not surfaced here — telemetry must never become a thing the lab waits on.
 */
export function createActionTracker({ track, now = Date.now }) {
  const lastDay = new Map();

  return function trackUserAction(method, pathname) {
    const name = actionFor(method, pathname);
    if (!name) return null;

    const day = utcDay(now());
    if (lastDay.get(name) === day) return null;
    lastDay.set(name, day);

    try {
      // Fire-and-forget, exactly like the CLI path. Telemetry must never break
      // the lab: a rejected promise here would be an unhandled rejection on a
      // request path.
      const result = track(name);
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch {
      // The SDK swallows its own errors, but a caller-supplied stub might not.
    }
    return name;
  };
}

export { USER_ACTIONS };
