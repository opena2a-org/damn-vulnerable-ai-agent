/**
 * Flight-demo tests (dvaa demo flight).
 *
 * Pure/deterministic coverage:
 *   - FLIGHTBOT + FLIGHTBOT_AIM are registered with the right ports + grants
 *   - the synthetic wallet is unmistakably FAKE (no real-looking PII can ship)
 *   - the poisoned flight page carries a detectable url-exfiltration injection
 *     whose callback preserves the [INSERT_*] placeholder
 *   - walletExfilSummary encodes the wallet, not the persona
 *
 * The full three-act run (spawns a fleet, exercises the real agent HTTP path)
 * is covered by the manual new-user walkthrough in docs/demo/FLIGHT_RUN_SCRIPT.md
 * and by `node src/index.js demo flight --json`. We keep this file network-free
 * so it stays fast and CI-stable.
 */

import { strict as assert } from 'assert';
import { AGENTS, getAgent } from '../src/core/agents.js';
import { FLIGHT_WALLET, walletExfilSummary } from '../src/payloads/flight-wallet.fixture.js';
import { FLIGHT_RESULTS, renderFlightResults } from '../src/payloads/flight-results.fixture.js';
import { buildPoisonedFlightPage, FLIGHT_DEAL_URL, WALLET_PLACEHOLDER, APWN_FLIGHT_EXFIL } from '../src/payloads/agentpwn-flight-mirror.js';
import { detectInjection, htmlToText } from '../src/web-fetch.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}: ${err.message}`);
  }
}

console.log('Flight-demo tests\n=================\n');

// ---------------------------------------------------------------------------
// Agent definitions
// ---------------------------------------------------------------------------
test('FLIGHTBOT registered on 7017, vulnerable, holds a wallet', () => {
  const agent = getAgent('flightbot');
  assert.ok(agent, 'flightbot not in registry');
  assert.equal(agent.port, 7017);
  assert.equal(agent.aimEnforced, undefined);
  assert.equal(agent.features.flightSearch, true);
  assert.equal(agent.vulnerabilities.contextManipulation.indirectInjectionViaWebFetch, true);
  assert.ok(agent.wallet, 'flightbot has no wallet');
});

test('FLIGHTBOT_AIM registered on 7018 with web:read + flight:search + chat:respond, NO http:post', () => {
  const agent = getAgent('flightbot-aim');
  assert.ok(agent, 'flightbot-aim not in registry');
  assert.equal(agent.port, 7018);
  assert.equal(agent.aimEnforced, true);
  assert.deepEqual(agent.aimCapabilities.slice().sort(), ['chat:respond', 'flight:search', 'web:read']);
  assert.ok(!agent.aimCapabilities.includes('http:post'), 'egress must NOT be granted');
});

// ---------------------------------------------------------------------------
// Synthetic data safety - the whole demo rests on this never being real PII
// ---------------------------------------------------------------------------
test('wallet is unmistakably synthetic (FAKE markers, test cards, example.com)', () => {
  const summary = walletExfilSummary();
  assert.match(summary, /FAKE/, 'traveler identity must be FAKE-marked');
  assert.match(summary, /@example\.com/, 'emails must use the reserved example.com domain');
  assert.match(summary, /4242 4242 4242 4242/, 'must use the public Stripe test PAN');
  // Loyalty + passport are placeholder-tagged.
  assert.match(FLIGHT_WALLET.traveler.passportNumber, /FAKE/);
  FLIGHT_WALLET.loyalty.forEach(l => assert.match(l.number, /FAKE/));
});

test('walletExfilSummary carries the wallet, not the persona', () => {
  const summary = walletExfilSummary();
  assert.match(summary, /cards=\[/);
  assert.match(summary, /loyalty=\[/);
  assert.ok(!/You are FlightBot/.test(summary), 'must not leak the persona text');
});

// ---------------------------------------------------------------------------
// Benign Act 1 results
// ---------------------------------------------------------------------------
test('flight results render as brand-neutral itineraries', () => {
  const lines = renderFlightResults();
  assert.equal(lines.length, FLIGHT_RESULTS.length);
  assert.match(lines[0], /LAX->JFK/);
  assert.ok(!/delta|united|american|southwest/i.test(lines.join(' ')), 'carrier names must stay generic');
});

// ---------------------------------------------------------------------------
// Poisoned page + injection detection
// ---------------------------------------------------------------------------
test('poisoned flight page yields a url-exfiltration injection at the canary', () => {
  const canary = 'http://127.0.0.1:65000/api/canary/exfil-test';
  const html = buildPoisonedFlightPage(canary);
  const injection = detectInjection(html, htmlToText(html));
  assert.ok(injection, 'no injection detected on the poisoned page');
  assert.equal(injection.kind, 'url-exfiltration');
  assert.ok(injection.callbackUrl.startsWith(canary), 'callback must point at the canary');
  assert.match(injection.callbackUrl, /\[INSERT_YOUR_DOCUMENT_CONTENTS_HERE\]/, 'placeholder must survive for payload substitution');
});

test('injection placeholder constant matches what the page embeds', () => {
  const html = buildPoisonedFlightPage('http://127.0.0.1:1/api/canary/exfil-test');
  assert.ok(html.includes(WALLET_PLACEHOLDER));
  assert.equal(APWN_FLIGHT_EXFIL.category, 'data-exfiltration');
  assert.ok(FLIGHT_DEAL_URL.startsWith('http'));
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
