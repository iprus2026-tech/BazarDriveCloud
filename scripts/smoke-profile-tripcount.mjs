// BD-PROFILE-01 / #717 — the driver's «количество поездок» must be DERIVED from
// completed passenger ride orders, never a hard-coded literal.
//
// Product rule: the trip count increments only when the driver drives a
// passenger-created ride order (the `bazardrive.ride_orders.v1` store) to LOGICAL
// COMPLETION (status COMPLETED). CANCELED / NO_SHOW / unfinished orders never count,
// and demo seeds are excluded. The hero shows the all-time total; the «За неделю»
// stat shows the last-7-days count. This pin locks the derivation + the wiring so a
// refactor can't silently re-introduce the old hard-coded 203 / 42.
//
// Static only: reads source, asserts invariants. No DOM, no network, no runtime.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const api = read('../public/src/mock_api.js');
const profile = read('../public/src/screens/profile.js');
const driverMap = read('../public/src/screens/driver_map.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// ── The derivation lives in the data layer and follows the rule ──
const fnMatch = api.match(/export function countCompletedPassengerTrips\(\)\s*\{[\s\S]*?\n\}/);
expect('mock_api exports countCompletedPassengerTrips()', !!fnMatch);
const fnBody = fnMatch ? fnMatch[0] : '';

expect('it counts only status === COMPLETED (logical completion)',
  /status\s*===\s*'COMPLETED'/.test(fnBody));
expect('it excludes demo seeds (honest, real completions only)',
  /!\s*o\.demo/.test(fnBody));
expect('it does NOT count CANCELED / NO_SHOW (only the COMPLETED filter gates the set)',
  !/CANCELED|NO_SHOW/.test(fnBody) && /status\s*===\s*'COMPLETED'/.test(fnBody));
expect('it derives the source from the ride_orders store (passenger-created orders)',
  /loadRideOrdersRaw\(\)/.test(fnBody));

// ── Origin guard (Codex #719): driver-surface orders must NOT count ──
expect('createRideOrder stamps a createdByRole origin marker (driver vs passenger)',
  /createdByRole:\s*input\.createdByRole\s*===\s*'driver'\s*\?\s*'driver'\s*:\s*'passenger'/.test(api));
expect('the count EXCLUDES driver-created orders (createdByRole !== driver)',
  /createdByRole\s*!==\s*'driver'/.test(fnBody));
expect('driver_map «Создать тестовый заказ» marks the test order createdByRole: driver',
  /createRideOrder\(\{[\s\S]{0,400}?createdByRole:\s*'driver'/.test(driverMap));
expect('it scopes a weekly count to the last 7 days (by statusUpdatedAt)',
  /7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(fnBody)
  && /statusUpdatedAt/.test(fnBody));
expect('it returns { total, thisWeek }',
  /return\s*\{\s*total:[\s\S]*thisWeek[\s\S]*\}/.test(fnBody));

// ── The driver profile consumes the derivation, not literals ──
expect('profile.js imports countCompletedPassengerTrips',
  /import\s*\{[^}]*countCompletedPassengerTrips[^}]*\}\s*from\s*'\.\.\/mock_api\.js'/.test(profile));

// Hero: derived lifetime total + correct Russian pluralisation; the old «203 поездки»
// literal is gone.
expect('driver hero renders the derived total with pluralRu (no hard-coded «203 поездки»)',
  /pf2-hero__trips">\$\{trips\}\s*\$\{pluralRu\(trips,/.test(profile)
  && !/203\s*поездки/.test(profile)
  && /const\s+trips\s*=\s*countCompletedPassengerTrips\(\)\.total/.test(profile));

// Weekly stat: derived this-week count; the old «42» literal is gone from the Поездок
// stat value.
expect('driver «За неделю» Поездок stat renders the derived weekly count (no hard-coded 42)',
  /const\s+weekTrips\s*=\s*countCompletedPassengerTrips\(\)\.thisWeek/.test(profile)
  && /pf2-stat-val">\$\{weekTrips\}<\/span>\s*<span class="pf2-stat-label">Поездок/.test(profile));

if (issues.length) {
  console.log(`\n${issues.length} FAILED:`);
  for (const i of issues) console.log(' - ' + i);
  process.exit(1);
}
console.log('\nALL PASSED');
