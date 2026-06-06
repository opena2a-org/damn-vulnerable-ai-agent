/**
 * Static benign flight-search results for Act 1 of `dvaa demo flight`.
 *
 * Deterministic so the opening beat ("find me flights") never depends on a
 * live API or an LLM key. These are made-up itineraries; carrier names are
 * generic to keep the demo brand-neutral and reusable at any venue.
 */

export const FLIGHT_RESULTS = [
  { flight: 'OA 100', from: 'LAX', to: 'JFK', depart: '08:15', arrive: '16:40', stops: 0, price: 318 },
  { flight: 'OA 244', from: 'LAX', to: 'JFK', depart: '11:50', arrive: '20:25', stops: 0, price: 286 },
  { flight: 'OA 512', from: 'LAX', to: 'JFK', depart: '14:05', arrive: '23:10', stops: 1, price: 219 },
];

/**
 * Render the results as compact terminal lines for the demo narration.
 */
export function renderFlightResults(results = FLIGHT_RESULTS) {
  return results.map(r => {
    const stops = r.stops === 0 ? 'nonstop' : `${r.stops} stop`;
    return `  ${r.flight}  ${r.from}->${r.to}  ${r.depart}-${r.arrive}  ${stops}  $${r.price}`;
  });
}
