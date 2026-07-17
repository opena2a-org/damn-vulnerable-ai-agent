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
 * satisfy neither, which is why dvaa reported 177 monthly actives against 1
 * engaged user while every other tool converted at 45-86%. The lab was being
 * used; it just never said so.
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

/** At most one event per action name per hour. */
const DEFAULT_THROTTLE_MS = 60 * 60 * 1000;

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
 * Throttled per action name: a user firing 100 payloads in a minute is one
 * engaged human, not 100 events. An hour is coarse enough to keep volume
 * trivial and fine enough that someone using the lab on two different days
 * produces an event on each — which is exactly what `engaged` measures.
 *
 * Note there is deliberately NO heartbeat or timer anywhere. A periodic ping
 * would make an idle container look like an active user, which is the same
 * fabrication as tracking the HEALTHCHECK. An unused lab reporting nothing is
 * the correct answer, not a gap.
 *
 * @param {object} o
 * @param {(name: string, fields?: object) => unknown} o.track usually tele.track
 * @param {() => number} [o.now] injectable for tests
 * @param {number} [o.throttleMs]
 * @returns {(method: string, pathname: string) => string|null} the action name
 *   if an event was emitted, else null (returned for tests/callers; the caller
 *   ignores it)
 */
export function createActionTracker({ track, now = Date.now, throttleMs = DEFAULT_THROTTLE_MS }) {
  const lastSent = new Map();

  return function trackUserAction(method, pathname) {
    const name = actionFor(method, pathname);
    if (!name) return null;

    const at = now();
    const previous = lastSent.get(name);
    if (previous !== undefined && at - previous < throttleMs) return null;
    lastSent.set(name, at);

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

export { DEFAULT_THROTTLE_MS, USER_ACTIONS };
