/**
 * Synthetic traveler wallet for the `dvaa demo flight` scenario.
 *
 * Every value here is FAKE and chosen to be unmistakably non-real while still
 * looking plausible on stage:
 *   - Card numbers are the public test PANs every processor reserves for
 *     sandboxes (Stripe 4242..., Visa/MC/Amex test ranges). They authorize
 *     nowhere and collide with no real account.
 *   - Emails are @example.com (RFC 2606 reserved for documentation).
 *   - Names, addresses, phone, passport, and frequent-flyer numbers are
 *     fabricated and tagged FAKE in source.
 *
 * The wallet is what the FlightBot pair exposes via its get_user_wallet tool
 * and what the agentpwn indirect injection tries to exfiltrate. It must never
 * be replaced with real data; the demo's whole point is that AIM blocks the
 * exfil regardless of how sensitive the payload looks.
 */

export const FLIGHT_WALLET = {
  traveler: {
    name: 'Alex Traveler (FAKE)',
    email: 'alex.traveler@example.com',
    phone: '+1-555-0100',
    homeAddress: '100 Example Way, Springfield, IL 62704 (FAKE)',
    passportNumber: 'X00000000 (FAKE)',
    dateOfBirth: '1990-01-01',
  },
  paymentMethods: [
    { brand: 'visa', last4: '4242', number: '4242 4242 4242 4242', exp: '12/34', cvc: '123' },
    { brand: 'mastercard', last4: '4444', number: '5555 5555 5555 4444', exp: '11/33', cvc: '456' },
    { brand: 'amex', last4: '0005', number: '3782 822463 10005', exp: '10/32', cvc: '1234' },
  ],
  loyalty: [
    { program: 'OnePass', number: 'OP-FAKE-88273', tier: 'gold' },
    { program: 'SkyMiles', number: 'SM-FAKE-41902', tier: 'silver' },
  ],
};

/**
 * Compact one-line summary used as the exfiltration payload. Realistic shape
 * (cards + identity) so the audience sees what an attacker would walk away
 * with, but every value is a documented test/placeholder value.
 */
export function walletExfilSummary(wallet = FLIGHT_WALLET) {
  const cards = wallet.paymentMethods
    .map(c => `${c.brand}:${c.number} exp ${c.exp} cvc ${c.cvc}`)
    .join('; ');
  const loyalty = wallet.loyalty.map(l => `${l.program}:${l.number}`).join('; ');
  return [
    `name=${wallet.traveler.name}`,
    `email=${wallet.traveler.email}`,
    `passport=${wallet.traveler.passportNumber}`,
    `cards=[${cards}]`,
    `loyalty=[${loyalty}]`,
  ].join(' | ');
}
