// BD-RIDE-WAITING-01E Codex P2 repair — static regression guard for the
// P2 fixes on PR #908:
//
//   P2-1: loadCanonicalActiveRide() (trip_confirmation_handoff.js) must
//   read-normalize a legacy persisted Ride whose waiting.remaining/
//   paidStartsAt still carry buildDemoRide()'s pre-v296 literal snapshot
//   ('2:30' / '14:18') to null/null, WITHOUT persisting the change (no
//   saveActiveRide/saveActiveRideStore call in the normalizer) and WITHOUT
//   mutating the object passed in (returns a shallow copy).
//
//   P2-2: waitingInfo() (active_ride_passenger.js) must not default pct to
//   100 when remaining is unknown ('—') — that would falsely assert a full
//   free-wait window for a state that is actually unknown. Both consumers
//   (the initial renderWaitingSheet markup and the live-refresh DOM patch)
//   must not stamp aria-valuenow="100" or a full progress-bar-fill step for
//   that case.
//
//   P2-1 hydration follow-up: loadPassengerRideView() (active_ride_passenger.js)
//   must not let upgradeStoredActiveRideForOrder()'s raw storage re-read
//   (a fresh findActiveRide() call that bypasses the normalizer above)
//   become the final hydrated Ride directly — the old `upgraded !== ride`
//   reference check reintroduced the legacy waiting leak on this path,
//   since two separate storage reads are always different object
//   references regardless of whether real upgrade content changed. The
//   final Ride must be re-derived through loadCanonicalActiveRide() so the
//   normalizer runs again after any upgrade/persist.
//
// STATIC source assertions only — no browser, no DOM, mirrors the existing
// smoke-active-ride-waiting.mjs (driver side) pattern for the passenger/
// handoff side.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const handoff = read('../public/src/screens/trip_confirmation_handoff.js');
const passenger = read('../public/src/screens/active_ride_passenger.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const paren = source.indexOf('(', start);
  if (paren === -1) return '';
  let pdepth = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') pdepth++;
    else if (ch === ')') { pdepth--; if (pdepth === 0) { afterParams = i + 1; break; } }
  }
  if (afterParams === -1) return '';
  const open = source.indexOf('{', afterParams);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return source.slice(open, i + 1); }
  }
  return '';
}

// ── P2-1 — legacy persisted Ride normalization ─────────────────────────
const normalizerBody = functionBody(handoff, 'normalizeLegacyWaitingLeak');
expect('trip_confirmation_handoff.js defines normalizeLegacyWaitingLeak',
  normalizerBody.length > 0);
expect('normalizer matches both legacy literals (2:30 AND 14:18) before nulling',
  /waiting\.remaining\s*!==\s*'2:30'/.test(normalizerBody)
    && /waiting\.paidStartsAt\s*!==\s*'14:18'/.test(normalizerBody));
expect('normalizer nulls remaining and paidStartsAt when matched',
  /remaining:\s*null/.test(normalizerBody) && /paidStartsAt:\s*null/.test(normalizerBody));
expect('normalizer returns a shallow copy (spreads ride), never mutates in place',
  /\{\s*\.\.\.ride\s*,/.test(normalizerBody));
expect('normalizer never persists (no saveActiveRide / saveActiveRideStore call)',
  !/saveActiveRide(Store)?\(/.test(normalizerBody));
expect('normalizer leaves freeLimit/paidRate untouched (only remaining/paidStartsAt keys nulled)',
  !/freeLimit:\s*null/.test(normalizerBody) && !/paidRate:\s*null/.test(normalizerBody));

const canonicalBody = functionBody(handoff, 'loadCanonicalActiveRide');
expect('loadCanonicalActiveRide defined', canonicalBody.length > 0);
expect('loadCanonicalActiveRide routes every non-null return through the normalizer',
  /return\s+normalizeLegacyWaitingLeak\(existing\)/.test(canonicalBody)
    && /return\s+normalizeLegacyWaitingLeak\(seeded\)/.test(canonicalBody)
    && /return\s+normalizeLegacyWaitingLeak\(crossSeeded\)/.test(canonicalBody));

// ── P2-2 — unknown wait progress must not report pct=100 ───────────────
const waitingInfoBody = functionBody(passenger, 'waitingInfo');
expect('active_ride_passenger.js defines waitingInfo', waitingInfoBody.length > 0);
expect('waitingInfo no longer defaults pct to 100',
  !/let\s+pct\s*=\s*100/.test(waitingInfoBody));
expect('waitingInfo defaults pct to null when remaining/freeLimit cannot be parsed',
  /let\s+pct\s*=\s*null/.test(waitingInfoBody));

const sheetBody = functionBody(passenger, 'renderWaitingSheet');
expect('renderWaitingSheet defined', sheetBody.length > 0);
expect('renderWaitingSheet gates aria-valuenow behind a w.pct == null check (not unconditionally stamped)',
  /w\.pct == null \? '' : ` aria-valuenow="\$\{w\.pct\}"`/.test(sheetBody));
expect('renderWaitingSheet does not fall back to a full (10) progress step when pct is null',
  !/Math\.round\(w\.pct \/ 10\)"/.test(sheetBody) || /w\.pct == null \? 0/.test(sheetBody));

const refreshBody = functionBody(passenger, 'refreshPassengerRideFieldsInPlace');
expect('refreshPassengerRideFieldsInPlace defined', refreshBody.length > 0);
expect('live refresh removes aria-valuenow (not sets "100") when waiting.pct is null',
  /waiting\.pct == null/.test(refreshBody) && /removeAttribute\('aria-valuenow'\)/.test(refreshBody));
expect('live refresh does not stamp a full (10) fill step when waiting.pct is null',
  /waiting\.pct == null \? 0/.test(refreshBody));

// ── P2-1 hydration follow-up — passenger re-read must stay normalized ──
const hydrationBody = functionBody(passenger, 'loadPassengerRideView');
expect('loadPassengerRideView defined', hydrationBody.length > 0);
expect('loadPassengerRideView still calls upgradeStoredActiveRideForOrder',
  /upgradeStoredActiveRideForOrder\(/.test(hydrationBody));
expect('after upgradeStoredActiveRideForOrder, the final ride is re-derived via loadCanonicalActiveRide (not the raw upgraded object directly)',
  /const\s+upgraded\s*=\s*upgradeStoredActiveRideForOrder\([^;]*\);[\s\S]{0,80}?if\s*\(upgraded\)\s*\{[\s\S]{0,120}?ride\s*=\s*loadCanonicalActiveRide\(\{\s*tripId,\s*role:\s*'passenger'\s*\}\)\s*\|\|\s*upgraded;/
    .test(hydrationBody));
expect('the raw upgraded return value can no longer become `ride` without a canonical re-read (no bare `ride = upgraded;` assignment)',
  !/\bride\s*=\s*upgraded;/.test(hydrationBody));
expect('the old reference-identity pattern (upgraded !== ride) is no longer the final hydration path',
  !/if\s*\(upgraded\s*&&\s*upgraded\s*!==\s*ride\)\s*ride\s*=\s*upgraded;/.test(hydrationBody));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
