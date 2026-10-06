/**
 * Environment for an agent fleet that a demo runner spawns.
 *
 * Explicit allowlist, NOT `...process.env`. The child is a deliberately
 * vulnerable agent fleet running on a presenter's laptop; spreading the whole
 * environment hands it every real credential in that shell - ANTHROPIC_API_KEY,
 * AWS_*, GITHUB_TOKEN - which is the exact thing these demos are about. Our own
 * scanner flags the spread as NEMO-007 HIGH, and it is right to.
 *
 * AIM_ENFORCEMENT is passed through deliberately: the run scripts document
 * toggling it to reproduce the unprotected behavior on the same agent.
 */

export const PASSTHROUGH = ['PATH', 'HOME', 'TMPDIR', 'NODE_ENV', 'LANG', 'LC_ALL', 'AIM_ENFORCEMENT'];

/**
 * The allowlisted variables from `source`, plus `overrides` (the demo's own
 * settings: data dir, cache mode, telemetry off). Nothing else is inherited.
 */
export function fleetEnv(overrides = {}, source = process.env) {
  const env = Object.fromEntries(
    PASSTHROUGH.filter(k => source[k] !== undefined).map(k => [k, source[k]]),
  );
  return Object.assign(env, overrides);
}
