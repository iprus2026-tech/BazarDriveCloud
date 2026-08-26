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
const driverHandoffSnapshot = read('../public/src/screens/driver_handoff_snapshot.js');
const tripConfirmation = read('../public/src/screens/trip_confirmation.js');

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
// BD-RIDE-WAITING-POLICY-01A (#912) — freeLimit/paidRate now come from the
// shared ride_waiting_policy.js constants, not re-typed literals. \b after
// each identifier so a similarly-prefixed wrong name (e.g.
// DEFAULT_FREE_WAIT_LIMIT_OVERRIDE) cannot satisfy this guard.
expect('buildRideFromPost sets the same explicit waiting override (freeLimit/null/null/paidRate) as the other real seed builders',
  /waiting:\s*\{[\s\S]{0,160}?freeLimit:\s*DEFAULT_FREE_WAIT_LIMIT\b[\s\S]{0,80}?remaining:\s*null[\s\S]{0,80}?paidStartsAt:\s*null[\s\S]{0,80}?paidRate:\s*DEFAULT_PAID_RATE_LABEL\b/
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

// ── BD-RIDE-WAITING-POLICY-01A (#912) — screen fallback consumers use the
// shared policy source, not independent literals. A narrow structural guard
// (this file already reads both screen sources in full): proves the import
// exists and that the canonical fallback sites reference the imported
// names, not a re-typed '3:00'/'8 ₽ за каждую минуту'. The short-form
// '8 ₽/мин' presentation label in active_ride.js's renderWaitingExpired()
// is a deliberately separate, out-of-scope UI copy string — asserted still
// present unchanged, not migrated. The numeric `|| 8` accrual fallbacks are
// a different type (not the string constant) and are asserted untouched too. ──
expect('active_ride_passenger.js imports the shared waiting-policy constants',
  /import\s*\{\s*DEFAULT_FREE_WAIT_LIMIT,\s*DEFAULT_PAID_RATE_LABEL\s*\}\s*from\s*'\.\.\/ride_waiting_policy\.js';/.test(passenger));
expect('waitingInfo derives its freeLimit/paidRate fallbacks from the shared constants, not local literals',
  /w\.freeLimit \|\| DEFAULT_FREE_WAIT_LIMIT\b/.test(waitingInfoBody)
  && /w\.paidRate \|\| DEFAULT_PAID_RATE_LABEL\b/.test(waitingInfoBody));
expect('active_ride.js imports the shared waiting-policy constants',
  /import\s*\{\s*DEFAULT_FREE_WAIT_LIMIT,\s*DEFAULT_PAID_RATE_LABEL\s*\}\s*from\s*'\.\.\/ride_waiting_policy\.js';/.test(driverScreen));
expect('active_ride.js\'s canonical freeLimit fallback sites no longer hard-code \'3:00\' anywhere',
  !/freeLimit\s*\|\|\s*'3:00'/.test(stripComments(driverScreen)));
expect('active_ride.js\'s canonical long-form paidRate fallback no longer hard-codes the literal, while the short-form presentation label in renderWaitingExpired stays untouched (out of #912 scope)',
  !/waiting\.paidRate \|\| '8 ₽ за каждую минуту'/.test(stripComments(driverScreen))
  && /waiting\.paidRate \|\| '8 ₽\/мин'/.test(driverScreen));
// Narrow, per-function invariant guards — NOT a whole-file `|| 8` occurrence
// count. A global count would fail on any unrelated future `|| 8` added
// anywhere else in this large file, misreporting it as a waiting-policy
// regression. Each of the three known accrual functions is checked in
// isolation via the same functionBody() helper already used throughout
// this file: an unrelated `|| 8` elsewhere in active_ride.js cannot affect
// this invariant, and losing/changing any one of the three intended
// fallbacks fails its own specific assertion below.
const liveAccruedPaidBody = functionBody(driverScreen, 'liveAccruedPaid');
expect('active_ride.js defines liveAccruedPaid', liveAccruedPaidBody.length > 0);
expect('liveAccruedPaid keeps its numeric paidRate-per-minute fallback (parsePaidRatePerMin(...) || 8) — untouched, out of #912 scope',
  /parsePaidRatePerMin\(/.test(liveAccruedPaidBody) && /\|\|\s*8\b/.test(liveAccruedPaidBody));

const startPaidTimerBody = functionBody(driverScreen, 'startPaidTimer');
expect('active_ride.js defines startPaidTimer', startPaidTimerBody.length > 0);
expect('startPaidTimer keeps its numeric paidRate-per-minute fallback (parsePaidRatePerMin(...) || 8) — untouched, out of #912 scope',
  /parsePaidRatePerMin\(/.test(startPaidTimerBody) && /\|\|\s*8\b/.test(startPaidTimerBody));

const renderWaitingExpiredBody = functionBody(driverScreen, 'renderWaitingExpired');
expect('active_ride.js defines renderWaitingExpired', renderWaitingExpiredBody.length > 0);
expect('renderWaitingExpired keeps its numeric paidRate-per-minute fallback (parsePaidRatePerMin(...) || 8) — untouched, out of #912 scope',
  /parsePaidRatePerMin\(/.test(renderWaitingExpiredBody) && /\|\|\s*8\b/.test(renderWaitingExpiredBody));

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

// ── BD-RIDE-PASSENGER-WAIT-COUNTDOWN-01A (#911) — passenger free-wait
// countdown ticks for LOCAL_ONLY rides too, reusing the one existing
// passenger setInterval (no second timer, no countdown-specific setTimeout
// loop) and issuing zero extra network calls when there is no backend. ────
expect('deriveWaitCountdown is exported for direct deterministic testing',
  /export function deriveWaitCountdown\(/.test(passenger));
expect('waitingInfo is exported for direct deterministic testing',
  /export function waitingInfo\(/.test(passenger));
expect('active_ride_passenger.js still contains exactly one setInterval call site',
  (passenger.match(/\bsetInterval\(/g) || []).length === 1);

const startPollBody = functionBody(passenger, 'startPassengerRidePoll');
expect('startPassengerRidePoll defined', startPollBody.length > 0);
expect('startPassengerRidePoll no longer gates its start on backendRide alone (the pre-#911 combined guard is gone)',
  !/if\s*\(passengerPollId\s*\|\|\s*fixture\s*\|\|\s*!backendRide\)\s*return;/.test(startPollBody));
expect('startPassengerRidePoll still refuses to start a second interval or run for a fixture',
  /if\s*\(passengerPollId\s*\|\|\s*fixture\)\s*return;/.test(startPollBody));
expect('startPassengerRidePoll starts for a LOCAL_ONLY ride specifically when it is WAITING_PASSENGER (not for every LOCAL_ONLY status)',
  /if\s*\(!backendRide\s*&&\s*ride\.status\s*!==\s*RIDE_STATUS\.WAITING_PASSENGER\)\s*return;/.test(startPollBody));
expect('the detached-root teardown check still runs before anything else in the tick (countdown refresh cannot outlive teardown)',
  /if\s*\(!document\.body\.contains\(root\)\)\s*\{\s*teardownPassengerReads\(\);\s*return;\s*\}/.test(startPollBody));
const tickAfterTeardownGuard = startPollBody.split(/teardownPassengerReads\(\);\s*return;\s*\}/)[1] || '';
const refreshCallIndex = tickAfterTeardownGuard.indexOf('refreshPassengerRideFieldsInPlace()');
const backendGateIndex = tickAfterTeardownGuard.indexOf('if (!backendRide) return;');
const pollRideIndex = tickAfterTeardownGuard.indexOf('pollRide(');
expect('the tick calls refreshPassengerRideFieldsInPlace() gated on WAITING_PASSENGER status',
  /if\s*\(!destroyed\s*&&\s*ride\.status\s*===\s*RIDE_STATUS\.WAITING_PASSENGER\)\s*\{\s*refreshPassengerRideFieldsInPlace\(\);\s*\}/.test(tickAfterTeardownGuard));
expect('the countdown refresh runs BEFORE the backendRide network gate (a LOCAL_ONLY tick still refreshes the countdown)',
  refreshCallIndex !== -1 && backendGateIndex !== -1 && refreshCallIndex < backendGateIndex);
expect('a LOCAL_ONLY tick returns before ever reaching pollRide(...) — zero network calls',
  backendGateIndex !== -1 && pollRideIndex !== -1 && backendGateIndex < pollRideIndex);
expect('the pollRide(...) network call and its cursor handling are still present, unchanged shape (SERVER_BACKED polling preserved)',
  /res\s*=\s*await\s*pollRide\(ride\.tripId,\s*passengerCursor,\s*\{\s*signal:\s*controller\.signal\s*\}\)/.test(startPollBody)
  && /if\s*\(res\.cursor\)\s*passengerCursor\s*=\s*res\.cursor;/.test(startPollBody));
expect('forward server-status remount handling (maybeReMount / NAVIGATED) is still present, unchanged',
  /maybeReMount\(res\.status\)/.test(startPollBody) && /PASSENGER_REMOUNT_RESULT\.NAVIGATED/.test(startPollBody));
expect('refreshPassengerRideFieldsInPlace never calls saveActiveRide or localStorage — presentation-only, no persistence',
  !/saveActiveRide\(/.test(refreshBody) && !/localStorage\./.test(refreshBody));
const mountTailBody = passenger.slice(passenger.indexOf('setReadState(readState);'), passenger.lastIndexOf('return root;'));
expect('the factory mount tail calls startPassengerRidePoll() (idempotent — covers the LOCAL_ONLY case where runInitialRead() never runs at all, since backendRead is false)',
  /startPassengerRidePoll\(\);/.test(mountTailBody));
// BD-RIDE-PASSENGER-WAIT-COUNTDOWN-01A (#911) review-fix — the mount-tail
// call must be gated on readState already being LOADED at that exact
// synchronous point, not unconditional: an unconditional call could start
// the interval while a backend read is still in flight (readState LOADING)
// for a WAITING_PASSENGER ride with no usable local source, and neither the
// EMPTY(404) nor generic-error branch of runInitialRead ever stops it —
// an orphan no-op interval surviving until navigation/unmount.
expect('the mount-tail startPassengerRidePoll() call is gated on readState === PASSENGER_RIDE_READ_STATE.LOADED (not unconditional)',
  /if\s*\(readState\s*===\s*PASSENGER_RIDE_READ_STATE\.LOADED\)\s*startPassengerRidePoll\(\);/.test(mountTailBody));

const runInitialReadBody = functionBody(passenger, 'runInitialRead');
expect('runInitialRead defined', runInitialReadBody.length > 0);
const srvFallbackBody = runInitialReadBody.slice(
  runInitialReadBody.indexOf('if (!srv) {'),
  runInitialReadBody.indexOf('backendRide = true;'));
expect('the !srv fallback branch is present', srvFallbackBody.length > 0);
// BD-RIDE-PASSENGER-WAIT-COUNTDOWN-01A (#911) code-review fix — the !srv
// fallback (a server read resolving with no ride, settling the screen back
// to LOCAL_ONLY) renders a LOADED ride via renderLoadedRide(true) at a point
// where the factory-tail mount gate already ran with readState still
// LOADING, so this branch is the only remaining place that can start the
// poll for it — without this call a WAITING_PASSENGER countdown here paints
// one live waitingInfo() snapshot and then freezes, never ticking again.
expect('the !srv fallback branch calls startPassengerRidePoll() after rendering the loaded ride',
  /renderLoadedRide\(true\);[\s\S]{0,600}?startPassengerRidePoll\(\);/.test(srvFallbackBody));
const srvReconcileIndex = srvFallbackBody.indexOf('reconcileLocalOnlyRide()');
const srvRenderIndex = srvFallbackBody.indexOf('renderLoadedRide(true);');
const srvStartPollIndex = srvFallbackBody.indexOf('startPassengerRidePoll();');
const srvReturnIndex = srvFallbackBody.lastIndexOf('return;');
expect('the !srv fallback keeps the required order: reconcile -> render loaded ride -> start poll -> return',
  srvReconcileIndex !== -1 && srvRenderIndex !== -1 && srvStartPollIndex !== -1 && srvReturnIndex !== -1
  && srvReconcileIndex < srvRenderIndex && srvRenderIndex < srvStartPollIndex && srvStartPollIndex < srvReturnIndex);

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

// ── #910 — driver handoff snapshot must count as a real-ride marker,
// but ONLY when it actually is one (Codex P2 follow-up) ─────────────────
// applyDriverHandoffSnapshotToRide (driver_handoff_snapshot.js) is the only
// enrichment a genuine driver accept (trip_confirmation.js's
// goActiveRideDriver, via saveDriverHandoffSnapshot) leaves on the demo
// fallback ride — it never touched orderId/acceptedSource, so the shared
// normalizer above could never recognize such a ride as real and its
// inherited 2:30/14:18 waiting leak was permanent. Fix: stamp
// acceptedSource on the overlay so it flows through the existing
// explicitRealCandidate signal — but DRIVER_CONFIRMED is also reachable via
// a bare ?state=DRIVER_CONFIRMED deep link (documented SIM_AUDIT path) with
// no real handoff behind it, so the snapshot now carries an explicit
// provenance and the overlay only trusts an exact 'confirmed_handoff' value;
// anything else stamps the existing localProvenance = 'sim_audit' marker
// instead, preserving the intentional demo fixture for the audit flow.
const normalizeProvenanceBody = functionBody(driverHandoffSnapshot, 'normalizeProvenance');
expect('driver_handoff_snapshot.js defines normalizeProvenance', normalizeProvenanceBody.length > 0);
expect('normalizeProvenance only ever returns \'confirmed_handoff\' for an exact match, \'sim_audit\' otherwise (fail-closed, not inferred)',
  /value\s*===\s*'confirmed_handoff'\s*\?\s*'confirmed_handoff'\s*:\s*'sim_audit'/.test(normalizeProvenanceBody));

const saveSnapshotBody = functionBody(driverHandoffSnapshot, 'saveDriverHandoffSnapshot');
expect('saveDriverHandoffSnapshot defined', saveSnapshotBody.length > 0);
expect('saveDriverHandoffSnapshot persists provenance through normalizeProvenance(input.provenance)',
  /provenance:\s*normalizeProvenance\(input\.provenance\)/.test(saveSnapshotBody));

const loadSnapshotBody = functionBody(driverHandoffSnapshot, 'loadDriverHandoffSnapshot');
expect('loadDriverHandoffSnapshot defined', loadSnapshotBody.length > 0);
expect('loadDriverHandoffSnapshot re-normalizes provenance on read through normalizeProvenance(entry.provenance) (never trusts raw storage)',
  /provenance:\s*normalizeProvenance\(entry\.provenance\)/.test(loadSnapshotBody));

const applySnapshotBody = functionBody(driverHandoffSnapshot, 'applyDriverHandoffSnapshotToRide');
expect('applyDriverHandoffSnapshotToRide defined', applySnapshotBody.length > 0);
expect('applyDriverHandoffSnapshotToRide branches on normalizeProvenance(snapshot.provenance) === \'confirmed_handoff\' before choosing acceptedSource vs. localProvenance',
  /normalizeProvenance\(snapshot\.provenance\)\s*===\s*'confirmed_handoff'/.test(applySnapshotBody));
expect('the confirmed-handoff branch stamps ride.acceptedSource (defaulting to \'driver_handoff\', preserving any existing value)',
  /acceptedSource:\s*safeText\(ride\.acceptedSource,\s*'driver_handoff'\)/.test(applySnapshotBody));
expect('the non-confirmed branch stamps the existing localProvenance = \'sim_audit\' marker instead (defaulting, preserving any existing value) — never acceptedSource',
  /localProvenance:\s*safeText\(ride\.localProvenance,\s*'sim_audit'\)/.test(applySnapshotBody));

// ── trip_confirmation.js — the writer must record which path it took ────
// Codex P2 round 2: handoff.role is who WROTE the record (chat→confirmation
// is always stored role='passenger' — that's exactly why goActiveRideDriver
// falls back to a driver snapshot at all), never who is viewing it. A
// role-equality gate here would reject every genuine driver confirm.
const goActiveRideDriverBody = functionBody(tripConfirmation, 'goActiveRideDriver');
expect('trip_confirmation.js defines goActiveRideDriver', goActiveRideDriverBody.length > 0);
expect('goActiveRideDriver threads an explicit provenance into saveDriverHandoffSnapshot (never omitted, never left for the callee to guess)',
  /provenance:\s*isConfirmedHandoff\s*\?\s*'confirmed_handoff'\s*:\s*'sim_audit'/.test(goActiveRideDriverBody));

const isConfirmedHandoffRecordBody = functionBody(tripConfirmation, 'isConfirmedHandoffRecord');
expect('trip_confirmation.js exports isConfirmedHandoffRecord', isConfirmedHandoffRecordBody.length > 0);
expect('isConfirmedHandoffRecord is exported (not just a local helper) so tests can exercise it directly',
  /export\s+function\s+isConfirmedHandoffRecord\(/.test(tripConfirmation));
expect('isConfirmedHandoffRecord checks state === \'CONFIRMED\' and freshness only',
  /Boolean\(handoff\s*&&\s*handoff\.state\s*===\s*'CONFIRMED'\s*&&\s*!isHandoffExpired\(handoff\)\)/.test(isConfirmedHandoffRecordBody));
expect('isConfirmedHandoffRecord does NOT compare handoff.role against the viewer role (the round-1 regression) — no role-equality anywhere in its body',
  !/handoff\.role\s*===\s*role/.test(isConfirmedHandoffRecordBody) && !/role\s*===\s*handoff\.role/.test(isConfirmedHandoffRecordBody));
expect('the driver-facing isConfirmedHandoff variable is derived from isConfirmedHandoffRecord(handoff), not re-implemented inline',
  /isConfirmedHandoff\s*=\s*isConfirmedHandoffRecord\(handoff\)/.test(tripConfirmation));

// ── BD-RIDE-WAITING-PAID-01A — passenger free→paid presentation boundary ──
const passengerDeriveWaitBody = functionBody(passenger, 'deriveWaitCountdown');
expect('passenger wait derivation exposes FREE_WAIT / PAID_WAIT from one arrivedAt+freeLimit deadline',
  /PASSENGER_WAIT_PHASE\.FREE_WAIT/.test(passengerDeriveWaitBody)
  && /PASSENGER_WAIT_PHASE\.PAID_WAIT/.test(passengerDeriveWaitBody)
  && /nowMs\s*<\s*deadlineMs/.test(passengerDeriveWaitBody));
expect('passenger paid elapsed derives from nowMs - deadlineMs, not from callback count',
  /paidElapsedSec[\s\S]{0,180}?nowMs\s*-\s*deadlineMs/.test(passengerDeriveWaitBody));
expect('passenger derivation contains no monetary accrual calculation',
  !/parsePaidRatePerMin|ratePerMin|accrued|amount\s*:|cost\s*:/.test(stripComments(passengerDeriveWaitBody)));
expect('Ride State Machine still has no PAID_WAIT status', !/PAID_WAIT/.test(rideState));
expect('waitingInfo unknown-arrival fallback keeps phase null instead of inventing paid wait',
  /phase:\s*null/.test(waitingInfoBody) && /paidElapsedSec:\s*null/.test(waitingInfoBody));
expect('renderWaitingSheet has truthful passenger paid-wait copy without an accrued-money claim',
  sheetBody.includes('Бесплатное ожидание закончилось')
  && sheetBody.includes('Платное ожидание')
  && !/Начислено|начислено/.test(sheetBody));
expect('refreshPassengerRideFieldsInPlace switches paid copy in place and hides the free progressbar',
  /isPaidWait[\s\S]{0,1200}?progress\.hidden\s*=\s*isPaidWait/.test(refreshBody)
  && refreshBody.includes('Бесплатное ожидание закончилось')
  && refreshBody.includes('Платное ожидание'));
expect('paid-boundary refresh remains presentation-only: no status/storage/backend writer calls',
  !/updateActiveRideStatus\(|patchRideStatus\(|updateTripStatus\(|saveActiveRide\(|localStorage\.setItem/.test(refreshBody));

// ── BD-RIDE-WAITING-PAID-01A review-fix — one waitingInfo() snapshot shared
// by the top card and the waiting sheet within each render/refresh pass, so
// the two surfaces can never observe opposite sides of the exact
// FREE_WAIT/PAID_WAIT deadline. Structural coverage only — proves the single
// call site and the shared variable, not a DOM-level runtime race. ─────────
expect('topDriverCardEta accepts an optional precomputed waitingSnapshot instead of always deriving its own',
  /function\s+topDriverCardEta\(ride,\s*phase,\s*waitingSnapshot\s*=\s*null\)/.test(passenger)
  && /waitingSnapshot\s*\|\|\s*waitingInfo\(ride\)/.test(functionBody(passenger, 'topDriverCardEta')));
expect('renderWaitingSheet accepts the same optional precomputed waitingSnapshot',
  /function\s+renderWaitingSheet\(sheet,\s*ride,\s*waitingSnapshot\s*=\s*null\)/.test(passenger)
  && /waitingSnapshot\s*\|\|\s*waitingInfo\(ride\)/.test(sheetBody));
expect('refreshPassengerRideFieldsInPlace calls waitingInfo(ride) exactly once per pass (not independently for top-card and sheet)',
  (stripComments(refreshBody).match(/waitingInfo\(ride\)/g) || []).length === 1);
expect('refreshPassengerRideFieldsInPlace threads that one snapshot into topDriverCardEta(...)',
  /topDriverCardEta\(ride,\s*phaseQuery,\s*waitingSnapshot\)/.test(refreshBody));
expect('refreshPassengerRideFieldsInPlace reuses the same snapshot for the WAITING_PASSENGER block instead of a second waitingInfo(ride) call',
  /const\s+waiting\s*=\s*waitingSnapshot;/.test(refreshBody));
const setReadStateBody = functionBody(passenger, 'setReadState');
expect('setReadState defined', setReadStateBody.length > 0);
expect('the initial LOADED render pass computes one waitingInfo(ride) snapshot and passes the SAME object to both renderTopCard(...) and renderSheet(...)',
  /const\s+waitingSnapshot\s*=\s*ride\.status\s*===\s*RIDE_STATUS\.WAITING_PASSENGER\s*\?\s*waitingInfo\(ride\)\s*:\s*null;/.test(setReadStateBody)
  && /renderTopCard\(waitingSnapshot\)/.test(setReadStateBody)
  && /renderSheet\(waitingSnapshot\)/.test(setReadStateBody));

console.log('\n' + (issues.length
  ? `FAIL ${issues.length} expectation(s):\n  - ` + issues.join('\n  - ')
  : 'ALL PASSED'));
process.exit(issues.length ? 1 : 0);
