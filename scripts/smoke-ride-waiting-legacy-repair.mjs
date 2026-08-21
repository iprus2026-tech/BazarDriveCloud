// BD-RIDE-WAITING-01E — static regression guard for the waiting-leak repair
// series on PR #908, now converged on one shared store-level contract:
//
//   Root fix: ride_state.js owns a single shared normalizer for the legacy
//   pre-v296 demo-waiting leak (waiting.remaining/paidStartsAt frozen at
//   buildDemoRide()'s '2:30'/'14:18' snapshot on a real Ride). Applied at
//   the read boundary (findActiveRide, and therefore getActiveRide) and the
//   write boundary (saveActiveRide), so every caller — updateActiveRideStatus,
//   loadCanonicalActiveRide, upgradeStoredActiveRideForOrder, etc. — gets a
//   normalized Ride without needing its own screen-level patch. The earlier
//   screen-local normalizer in trip_confirmation_handoff.js (P2-1) has been
//   removed in favor of this shared boundary.
//
//   Real-ride discriminator: conservative, existing-data only (no new
//   provenance field) — primary signal is a non-empty orderId OR a
//   non-empty acceptedSource. tripId SHAPE is NOT a general-purpose
//   discriminator (an arbitrary non-feed sim/audit tripId with neither
//   marker stays untouched, same as DEMO_ACTIVE_RIDE_ID). The one narrow
//   exception is a feed- tripId prefix: acceptPassengerRequestFromPost/
//   buildRideFromPost used that reserved namespace for REAL marketplace
//   accepts before the acceptedSource marker existed, so a pre-existing
//   feed-* record with neither marker is still recovered as a historical
//   migration case — not a claim that tripId shape is proof of identity
//   in general.
//
//   Marketplace real seed: ride_actions.js::buildRideFromPost (the
//   feed-/post_detail accept path, previously missed by every earlier
//   waiting-leak fix) carries the same explicit waiting override as
//   ride_seed.js/seedActiveRideFromAcceptedOrder, AND
//   acceptPassengerRequestFromPost stamps acceptedSource = 'feed_post_accept'
//   before persisting — the same existing marker
//   seedActiveRideFromAcceptedOrder already uses — since this is the one
//   real-seed path with no orderId to rely on. New feed accepts are
//   protected by this marker; the feed- tripId exception above exists only
//   for records predating it.
//
//   Driver paidStartsAt: active_ride.js no longer falls back to the literal
//   '14:18' unconditionally. When timestamps.arrivedAt is valid it derives
//   a real clock time from arrivedAt + freeLimit (the same anchor
//   waitDeadlineMs() already trusts). When arrivedAt is missing: a real
//   ride (same discriminator as the store normalizer) shows an honest '—'
//   — never the stale demo literal; a non-real ride (demo/sim, no markers)
//   may still show its own intentional waiting.paidStartsAt fixture value
//   (e.g. the canonical demo's '14:18', or a designed sim snapshot), or
//   '—' if it has none. No new timer, no new persisted field, no arrivedAt
//   stamped from a query simulation.
//
//   P2-2 (unchanged, still guarded here): waitingInfo() (active_ride_passenger.js)
//   must not default pct to 100 when remaining is unknown ('—'). Both
//   consumers (renderWaitingSheet, the live-refresh DOM patch) must not
//   stamp aria-valuenow="100" or a full progress-bar-fill step for that case.
//
//   Passenger hydration re-read (unchanged, still guarded here):
//   loadPassengerRideView() must not let upgradeStoredActiveRideForOrder()'s
//   return value become the final hydrated Ride without a canonical
//   re-read — kept as defensive belt-and-suspenders even though the shared
//   ride_state.js boundary now normalizes upgradeStoredActiveRideForOrder's
//   own raw findActiveRide() call too.
//
//   Explicit local simulation provenance (localProvenance = 'sim_audit'):
//   legacyFeedAccept alone cannot distinguish an unmarked historical real
//   feed accept from a transient driver/passenger simulation fallback that
//   happens to share the same feed- tripId shape — both look identical in
//   storage. localProvenance is a LOCAL-ONLY marker (never sent to/read
//   from the backend, never part of the DB/API contract), stamped only by
//   the driver (active_ride.js) and passenger (active_ride_passenger.js)
//   simulation-fallback constructors when no real driverSnapshot/handoff
//   backs them, and cleared by both screens' mergeServerRide the moment a
//   successful server read proves the ride real. Priority: an explicit
//   real marker (orderId/acceptedSource) always wins over a sim marker;
//   otherwise a sim marker blocks legacyFeedAccept entirely; otherwise
//   legacyFeedAccept still recovers a genuinely unmarked historical record.
//
// STATIC source assertions only — no browser, no DOM, mirrors the existing
// smoke-active-ride-waiting.mjs (driver side) pattern for the passenger/
// handoff/store side.

import fs from 'node:fs';

const read = (rel) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const rideState = read('../public/src/ride_state.js');
const handoff = read('../public/src/screens/trip_confirmation_handoff.js');
const passenger = read('../public/src/screens/active_ride_passenger.js');
const rideActions = read('../public/src/ride_actions.js');
const driverScreen = read('../public/src/screens/active_ride.js');

const issues = [];
function expect(label, cond, detail = '') {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + label + (detail ? ' (' + detail + ')' : ''));
  if (!cond) issues.push(label + (detail ? ' :: ' + detail : ''));
}

// Strip JS comments so an explanatory comment describing the OLD removed
// pattern (e.g. "the old `waiting.paidStartsAt || '14:18'` fallback showed
// ...") cannot false-fail a negative code-scan below. Preserves URL-shaped
// `://` (e.g. import 'https://...'). Smoke-local — no parser dependency.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
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

// ── Shared store-level normalizer (ride_state.js) — root fix ────────────
const sharedNormalizerBody = functionBody(rideState, 'normalizeLegacyWaitingLeak');
expect('ride_state.js defines the shared normalizeLegacyWaitingLeak',
  sharedNormalizerBody.length > 0);
expect('shared normalizer\'s explicit real-candidate signal is a non-empty orderId OR a non-empty acceptedSource',
  /explicitRealCandidate\s*=\s*nonEmptyString\(ride\.orderId\)\s*\|\|\s*nonEmptyString\(ride\.acceptedSource\)/
    .test(sharedNormalizerBody));
expect('shared normalizer recognizes localProvenance === \'sim_audit\' as explicit simulation, only when no explicit real marker is present',
  /explicitSimulation\s*=\s*!explicitRealCandidate\s*&&\s*ride\.localProvenance\s*===\s*'sim_audit'/
    .test(sharedNormalizerBody));
expect('shared normalizer\'s explicit real-candidate signal (orderId/acceptedSource) takes priority over the simulation marker',
  sharedNormalizerBody.indexOf('explicitRealCandidate') < sharedNormalizerBody.indexOf('explicitSimulation'));
expect('shared normalizer\'s simulation marker blocks the legacy feed- exception (legacyFeedAccept excludes explicitSimulation)',
  /legacyFeedAccept\s*=\s*!explicitRealCandidate\s*&&\s*!explicitSimulation[\s\S]{0,100}?ride\.tripId\.startsWith\('feed-'\)/
    .test(sharedNormalizerBody)
    && /isRealCandidate\s*=\s*explicitRealCandidate\s*\|\|\s*legacyFeedAccept/.test(sharedNormalizerBody));
expect('shared normalizer still recovers a genuinely unmarked legacy feed- record (legacyFeedAccept not deleted)',
  /ride\.tripId\.startsWith\('feed-'\)/.test(sharedNormalizerBody));
expect('shared normalizer matches both legacy literals (2:30 AND 14:18) before nulling',
  /waiting\.remaining\s*!==\s*'2:30'/.test(sharedNormalizerBody)
    && /waiting\.paidStartsAt\s*!==\s*'14:18'/.test(sharedNormalizerBody));
expect('shared normalizer nulls remaining and paidStartsAt when matched',
  /remaining:\s*null/.test(sharedNormalizerBody) && /paidStartsAt:\s*null/.test(sharedNormalizerBody));
expect('shared normalizer returns a shallow copy (spreads ride), never mutates in place',
  /\{\s*\.\.\.ride\s*,/.test(sharedNormalizerBody));
expect('shared normalizer leaves freeLimit/paidRate untouched (only remaining/paidStartsAt keys nulled)',
  !/freeLimit:\s*null/.test(sharedNormalizerBody) && !/paidRate:\s*null/.test(sharedNormalizerBody));

// ── Read boundary — findActiveRide / getActiveRide ──────────────────────
const findActiveRideBody = functionBody(rideState, 'findActiveRide');
expect('findActiveRide defined', findActiveRideBody.length > 0);
expect('findActiveRide routes its return through the shared normalizer',
  /normalizeLegacyWaitingLeak\(existing\)/.test(findActiveRideBody));

const getActiveRideBody = functionBody(rideState, 'getActiveRide');
expect('getActiveRide defined', getActiveRideBody.length > 0);
expect('getActiveRide existing-record path reads through findActiveRide (the normalized boundary), not a raw store read',
  /const\s+existing\s*=\s*findActiveRide\(tripId\)/.test(getActiveRideBody));
expect('getActiveRide still auto-creates a demo ride when nothing exists',
  /createDemoActiveRide\(\{\s*tripId\s*\}\)/.test(getActiveRideBody));

// ── Write boundary — saveActiveRide ──────────────────────────────────────
const saveActiveRideBody = functionBody(rideState, 'saveActiveRide');
expect('saveActiveRide defined', saveActiveRideBody.length > 0);
expect('saveActiveRide normalizes the incoming ride before persisting (write boundary)',
  /const\s+normalized\s*=\s*normalizeLegacyWaitingLeak\(ride\)/.test(saveActiveRideBody)
    && /store\[ride\.tripId\]\s*=\s*normalized/.test(saveActiveRideBody)
    && /return\s+normalized;/.test(saveActiveRideBody));
expect('saveActiveRide still returns the existing (now normalized) record on the terminal-freeze path',
  /return\s+normalizeLegacyWaitingLeak\(existing\);/.test(saveActiveRideBody));
expect('saveActiveRide terminal-freeze guard is unchanged (still gates on TERMINAL_RIDE_STATUSES + status mismatch)',
  /TERMINAL_RIDE_STATUSES\.has\(existing\.status\)/.test(saveActiveRideBody)
    && /ride\.status\s*!==\s*existing\.status/.test(saveActiveRideBody));

// ── trip_confirmation_handoff.js — screen-local normalizer removed ──────
expect('trip_confirmation_handoff.js no longer defines its own normalizeLegacyWaitingLeak (superseded by the shared ride_state.js boundary)',
  !/function\s+normalizeLegacyWaitingLeak\(/.test(handoff));

const canonicalBody = functionBody(handoff, 'loadCanonicalActiveRide');
expect('loadCanonicalActiveRide defined', canonicalBody.length > 0);
expect('loadCanonicalActiveRide relies on findActiveRide directly again (no local re-wrapping)',
  /const\s+existing\s*=\s*findActiveRide\(tripId\);\s*\n\s*if\s*\(existing\)\s*return\s+existing;/.test(canonicalBody));

// ── Marketplace real seed — ride_actions.js::buildRideFromPost /
// acceptPassengerRequestFromPost ──────────────────────────────────────────
const buildRideFromPostBody = functionBody(rideActions, 'buildRideFromPost');
expect('buildRideFromPost defined', buildRideFromPostBody.length > 0);
expect('buildRideFromPost sets the same explicit waiting override (freeLimit/null/null/paidRate) as the other real seed builders',
  /waiting:\s*\{[\s\S]{0,160}?freeLimit:\s*'3:00'[\s\S]{0,80}?remaining:\s*null[\s\S]{0,80}?paidStartsAt:\s*null[\s\S]{0,80}?paidRate:\s*'8 ₽ за каждую минуту'/
    .test(buildRideFromPostBody));

const acceptPassengerRequestBody = functionBody(rideActions, 'acceptPassengerRequestFromPost');
expect('acceptPassengerRequestFromPost defined', acceptPassengerRequestBody.length > 0);
expect('acceptPassengerRequestFromPost stamps acceptedSource = \'feed_post_accept\' before saveActiveRide (its only provenance marker, since it has no orderId)',
  /ride\.acceptedSource\s*=\s*'feed_post_accept';[\s\S]{0,80}?saveActiveRide\(ride\);/.test(acceptPassengerRequestBody));

// ── Driver paidStartsAt — active_ride.js ─────────────────────────────────
expect('active_ride.js no longer contains the literal waiting.paidStartsAt || \'14:18\' render fallback in code (comment-stripped scan)',
  !/waiting\.paidStartsAt\s*\|\|\s*'14:18'/.test(stripComments(driverScreen)));
const isRealWaitingCandidateBody = functionBody(driverScreen, 'isRealWaitingCandidate');
expect('active_ride.js defines isRealWaitingCandidate with orderId as a render-time real signal',
  isRealWaitingCandidateBody.length > 0 && /ride\.orderId/.test(isRealWaitingCandidateBody));
expect('active_ride.js isRealWaitingCandidate includes acceptedSource as a render-time real signal',
  /ride\.acceptedSource/.test(isRealWaitingCandidateBody));
expect('active_ride.js isRealWaitingCandidate does NOT treat a feed- tripId prefix as a render-time real signal (only ride_state.js\'s persisted-store normalizer may — a transient in-memory demo can carry an arbitrary caller-supplied tripId)',
  !/startsWith\('feed-'\)/.test(isRealWaitingCandidateBody));

const paidStartLabelBody = functionBody(driverScreen, 'paidStartLabel');
expect('active_ride.js defines paidStartLabel', paidStartLabelBody.length > 0);
expect('paidStartLabel (arrivedAt path): derives a clock from timestamps.arrivedAt (Date.parse) + freeLimit when arrivedAt is valid',
  /Date\.parse\(\(ride\.timestamps/.test(paidStartLabelBody)
    && /if\s*\(Number\.isFinite\(arrivedMs\)\)/.test(paidStartLabelBody));
expect('paidStartLabel (real, no-arrivedAt path): a real waiting candidate returns an honest \'—\', never the stale waiting.paidStartsAt',
  /if\s*\(isRealWaitingCandidate\(\)\)\s*return\s*'—';/.test(paidStartLabelBody));
expect('paidStartLabel (non-real, no-arrivedAt path): may return the intentional waiting.paidStartsAt fixture/sim snapshot, or \'—\' if none',
  /waiting\.paidStartsAt\.trim\(\)\s*\?\s*waiting\.paidStartsAt\s*:\s*'—'/.test(paidStartLabelBody));
expect('paidStartLabel formats via the existing ru-RU HH:MM convention (toLocaleTimeString), not a new ad-hoc format',
  /toLocaleTimeString\('ru-RU',\s*\{\s*hour:\s*'2-digit',\s*minute:\s*'2-digit'\s*\}\)/.test(paidStartLabelBody));
expect('paidStartLabel does not introduce a new setInterval/setTimeout timer',
  !/set(Interval|Timeout)\(/.test(paidStartLabelBody));
expect('renderWaiting uses paidStartLabel() in place of the old literal fallback',
  /escapeHtml\(paidStartLabel\(\)\)/.test(driverScreen));

// ── Driver transient simulation provenance — active_ride.js ─────────────
const driverActiveRideBody = functionBody(driverScreen, 'activeRide');
expect('active_ride() stamps ride.localProvenance = \'sim_audit\' only when no real driverSnapshot backs the fallback',
  /ride\.localProvenance\s*=\s*'sim_audit'/.test(driverActiveRideBody));
expect('the driver simulation stamp is NOT gated on tripId shape (no startsWith(\'feed-\') anywhere near the stamp)',
  (() => {
    const idx = driverActiveRideBody.indexOf("ride.localProvenance = 'sim_audit'");
    if (idx === -1) return false;
    const window = driverActiveRideBody.slice(Math.max(0, idx - 300), idx);
    return !/startsWith\('feed-'\)/.test(window);
  })());
const driverMergeServerRideBody = functionBody(driverScreen, 'mergeServerRide');
expect('driver mergeServerRide defined', driverMergeServerRideBody.length > 0);
expect('driver mergeServerRide clears localProvenance from the merged server-backed projection',
  /delete\s+merged\.localProvenance;/.test(driverMergeServerRideBody));

// ── Driver server waiting reconciliation parity — active_ride.js ────────
// Mirrors active_ride_passenger.js's mergeServerWaiting exactly; the
// driver-side mergeServerRide previously had no `waiting:` key at all, so
// a transient sim-fallback's demo 2:30/14:18 survived server confirmation
// untouched even after localProvenance was cleared (Codex P2, active_ride.js:536).
const driverMergeServerWaitingBody = functionBody(driverScreen, 'mergeServerWaiting');
expect('driver mergeServerWaiting helper is defined',
  driverMergeServerWaitingBody.length > 0);
expect('driver mergeServerWaiting starts from a shallow local waiting copy',
  driverMergeServerWaitingBody.includes('const out = { ...(localWaiting || {}) }'));
expect('driver mergeServerWaiting overlays every non-null server waiting field onto the local copy',
  driverMergeServerWaitingBody.includes('for (const k in (serverWaiting || {}))')
    && driverMergeServerWaitingBody.includes('if (serverWaiting[k] != null) out[k] = serverWaiting[k]'));
expect('driver mergeServerWaiting explicitly nulls remaining when the server has no non-null remaining',
  driverMergeServerWaitingBody.includes('if (!serverWaiting || serverWaiting.remaining == null) out.remaining = null'));
expect('driver mergeServerWaiting explicitly nulls paidStartsAt when the server has no non-null paidStartsAt',
  driverMergeServerWaitingBody.includes('if (!serverWaiting || serverWaiting.paidStartsAt == null) out.paidStartsAt = null'));
expect('a non-null server remaining/paidStartsAt still wins (the overlay loop runs before the explicit-null clears)',
  driverMergeServerWaitingBody.indexOf('for (const k in (serverWaiting || {}))')
    < driverMergeServerWaitingBody.indexOf('if (!serverWaiting || serverWaiting.remaining == null)'));
expect('driver mergeServerRide uses mergeServerWaiting(...) for the waiting sub-object',
  driverMergeServerRideBody.includes('waiting: mergeServerWaiting(ride.waiting, srv.waiting)'));
expect('driver mergeServerWaiting/mergeServerRide never call saveActiveRide (pure, no persistence introduced)',
  !driverMergeServerWaitingBody.includes('saveActiveRide(')
    && !driverMergeServerRideBody.includes('saveActiveRide('));

// ── Persist server-confirmed driver waiting into an EXISTING stored Ride ──
// mergeServerRide's cleanup only ever lived in the in-memory `ride` closure
// variable; a pre-existing unmarked stored trip_* record never got the
// benefit of it, and the next status transition's independent
// findActiveRide() re-read in updateActiveRideStatus silently re-persisted
// the stale 2:30/14:18 pair (Codex follow-up, active_ride.js:553). This
// narrow repair helper fixes exactly that gap.
const persistRepairBody = functionBody(driverScreen, 'persistServerConfirmedWaitingProjection');
expect('persistServerConfirmedWaitingProjection helper is defined',
  persistRepairBody.length > 0);
expect('the repair helper reads the existing stored ride via findActiveRide(ride.tripId)',
  /const\s+storedRide\s*=\s*findActiveRide\(ride\.tripId\)/.test(persistRepairBody));
expect('the repair helper returns without saving when nothing is stored yet (no eager materialization)',
  /if\s*\(!storedRide\)\s*return;/.test(persistRepairBody));
expect('the repaired object is based on storedRide (not on ride / the server projection) — status, timestamps, tripId, orderId, acceptedSource, passenger, driver, route, cancel all survive from storage untouched',
  /\{\s*\.\.\.storedRide\s*,/.test(persistRepairBody));
expect('only waiting crosses from the cleaned in-memory ride into the repaired stored copy',
  /waiting:\s*\{\s*\.\.\.\(ride\.waiting\s*\|\|\s*\{\}\)\s*\}/.test(persistRepairBody));
expect('the repair helper deletes localProvenance from the repaired copy (server success proves the ride real)',
  /delete\s+repaired\.localProvenance;/.test(persistRepairBody));
expect('the repair helper does not fabricate orderId/acceptedSource/any other provenance field',
  !/repaired\.orderId\s*=/.test(persistRepairBody) && !/repaired\.acceptedSource\s*=/.test(persistRepairBody));
expect('the repair helper persists through the existing saveActiveRide (so the terminal-freeze guard there still applies unchanged)',
  /saveActiveRide\(repaired\)/.test(persistRepairBody));

const runInitialDriverReadBody = functionBody(driverScreen, 'runInitialDriverRead');
expect('runInitialDriverRead invokes the repair immediately after a successful mergeServerRide',
  /ride\s*=\s*mergeServerRide\(result\.value\);\s*\n\s*persistServerConfirmedWaitingProjection\(\);/
    .test(runInitialDriverReadBody));
expect('runInitialDriverRead does NOT invoke the repair on the local-miss / error branches',
  (() => {
    const mergeIdx = runInitialDriverReadBody.indexOf('mergeServerRide(result.value)');
    const afterMerge = runInitialDriverReadBody.slice(mergeIdx, mergeIdx + 200);
    const repairCallsAfterMerge = (afterMerge.match(/persistServerConfirmedWaitingProjection\(\)/g) || []).length;
    const tailAfterReturn = runInitialDriverReadBody.slice(runInitialDriverReadBody.indexOf('const err = result.error;'));
    return repairCallsAfterMerge === 1 && !tailAfterReturn.includes('persistServerConfirmedWaitingProjection(');
  })());

const refetchBody = functionBody(driverScreen, 'refetchRideAndRender');
expect('refetchRideAndRender invokes the repair immediately after a successful mergeServerRide',
  /ride\s*=\s*mergeServerRide\(srv\);\s*\n\s*persistServerConfirmedWaitingProjection\(\);/.test(refetchBody));

const pollOnceBody = functionBody(driverScreen, 'pollRideOnce');
expect('pollRideOnce invokes the repair immediately after a successful mergeServerRide',
  /ride\s*=\s*mergeServerRide\(srv\);\s*\n\s*persistServerConfirmedWaitingProjection\(\);/.test(pollOnceBody));

const noShowBody = functionBody(driverScreen, 'commitDriverNoShow');
expect('commitDriverNoShow does NOT gain a redundant repair call (it already persists the full authoritative merged ride via saveActiveRide)',
  !noShowBody.includes('persistServerConfirmedWaitingProjection('));

const persistDriverRideStatusBody = functionBody(driverScreen, 'persistDriverRideStatus');
expect('persistDriverRideStatus keeps its existing lazy-save-only-when-missing lifecycle sequence (no broadened "always save" overwrite)',
  /if\s*\(!findActiveRide\(ride\.tripId\)\)\s*saveActiveRide\(ride\);/.test(persistDriverRideStatusBody)
    && !persistDriverRideStatusBody.includes('persistServerConfirmedWaitingProjection('));

expect('ride_state.js remains untouched by this repair (no normalizeLegacyWaitingLeak / legacyFeedAccept edits alongside the driver reconciliation fix)',
  /function normalizeLegacyWaitingLeak\(ride\)\s*\{/.test(rideState)
    && /legacyFeedAccept/.test(rideState));

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
expect('loadPassengerRideView stamps ride.localProvenance = \'sim_audit\' only on its own fallback branch when no real snapshot backs it',
  /ride\.localProvenance\s*=\s*'sim_audit'/.test(hydrationBody));

// ── Focused guard — passenger backend reconciliation no longer uses the
// plain keep() for waiting (see scripts/smoke-passenger-active-ride-loading-states.mjs
// for the full mergeServerWaiting contract; this is a narrow negative scan
// only, not a duplicate of that smoke) ──────────────────────────────────
const mergeServerRideBody = functionBody(passenger, 'mergeServerRide');
expect('mergeServerRide defined', mergeServerRideBody.length > 0);
expect('mergeServerRide no longer merges waiting via the plain keep(ride.waiting, srv.waiting)',
  !/waiting:\s*keep\(ride\.waiting,\s*srv\.waiting\)/.test(mergeServerRideBody));
expect('passenger mergeServerRide clears localProvenance from the merged server-backed projection',
  /delete\s+merged\.localProvenance;/.test(mergeServerRideBody));

// ── Focused parity guard — passenger existing-storage waiting repair
// (full contract pinned in smoke-passenger-active-ride-loading-states.mjs;
// this is a narrow cross-check, not a duplicate) ─────────────────────────
const passengerRepairBody = functionBody(passenger, 'persistPassengerServerConfirmedWaitingProjection');
expect('passenger server-confirmed waiting repair helper exists',
  passengerRepairBody.length > 0);
expect('passenger repair bases the repaired object on storedRide (stored status/timestamps are preserved, not overwritten)',
  /\{\s*\.\.\.storedRide\s*,/.test(passengerRepairBody));
expect('passenger repair does not eagerly materialize a Ride when nothing is stored (findActiveRide + early return)',
  /const\s+storedRide\s*=\s*findActiveRide\(ride\.tripId\)/.test(passengerRepairBody)
    && /if\s*\(!storedRide\)\s*return;/.test(passengerRepairBody));
expect('accepted migration boundary unchanged — ride_state.js still defines the same legacyFeedAccept exception (no new heuristic added alongside this passenger parity slice)',
  /legacyFeedAccept\s*=\s*!explicitRealCandidate\s*&&\s*!explicitSimulation/.test(rideState));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
