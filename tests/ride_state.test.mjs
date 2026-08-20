// BD-TEST-01 — node:test coverage for the ride state machine.
//
// First behavioural (node:test) coverage in the repo, complementing the static
// smoke pins in scripts/check.mjs. Imports the real module
// (public/src/ride_state.js) and exercises its pure status contract plus the
// localStorage-backed terminal-status freeze (BD-ACTIVE-RIDE-TERM-01).
//
// ride_state.js touches `localStorage` only inside function bodies (never at
// module top level), so a minimal in-memory mock installed on globalThis is
// enough to drive the storage paths under Node — no browser, no DOM, no network.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  RIDE_STATUS,
  RIDE_STATUS_LABEL,
  RIDE_STATUS_TONE,
  resolveRideStatusLabel,
  resolveRideStatusTone,
  isValidRideStatus,
  getNextDriverStatus,
  saveActiveRide,
  findActiveRide,
  getActiveRide,
  updateActiveRideStatus,
  cancelActiveRide,
  loadActiveRideStore,
  saveActiveRideStore,
  DEMO_ACTIVE_RIDE_ID,
} from '../public/src/ride_state.js';

// ── in-memory localStorage mock ───────────────────────────────────────────────
function makeLocalStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
  };
}
globalThis.localStorage = makeLocalStorage();
beforeEach(() => { globalThis.localStorage.clear(); });

const ALL_STATUSES = Object.keys(RIDE_STATUS);
const TERMINAL = ['COMPLETED', 'CANCELED', 'NO_SHOW'];

// ── pure status contract (no storage) ─────────────────────────────────────────

test('RIDE_STATUS enum: each key maps to its own name string', () => {
  for (const key of ALL_STATUSES) {
    assert.equal(RIDE_STATUS[key], key, `RIDE_STATUS.${key} should equal "${key}"`);
  }
  // The lifecycle + terminal statuses the rest of the app depends on.
  for (const expected of [
    'NEW_ORDER', 'ACCEPTED', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP',
    'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED', 'NO_SHOW',
  ]) {
    assert.ok(ALL_STATUSES.includes(expected), `RIDE_STATUS missing ${expected}`);
  }
});

test('every status has a label and a tone, and resolvers return non-empty strings', () => {
  for (const key of ALL_STATUSES) {
    assert.equal(typeof RIDE_STATUS_LABEL[key], 'string', `no label for ${key}`);
    assert.ok(RIDE_STATUS_LABEL[key].length > 0, `empty label for ${key}`);
    assert.equal(typeof RIDE_STATUS_TONE[key], 'string', `no tone for ${key}`);
    assert.equal(typeof resolveRideStatusLabel(key), 'string');
    assert.ok(resolveRideStatusLabel(key).length > 0);
    assert.equal(typeof resolveRideStatusTone(key), 'string');
  }
});

test('resolvers do not throw on unknown / non-string input', () => {
  for (const bad of ['NOPE', '', null, undefined, 123, {}]) {
    assert.equal(typeof resolveRideStatusLabel(bad), 'string');
    assert.equal(typeof resolveRideStatusTone(bad), 'string');
  }
});

test('isValidRideStatus: true for real statuses, false for garbage and prototype keys', () => {
  for (const key of ALL_STATUSES) {
    assert.equal(isValidRideStatus(key), true, `${key} should be valid`);
  }
  for (const bad of [
    '', 'NOPE', 'completed', null, undefined, 123, {}, [],
    // prototype-pollution safety: isValidRideStatus uses hasOwnProperty.
    '__proto__', 'hasOwnProperty', 'toString', 'constructor',
  ]) {
    assert.equal(isValidRideStatus(bad), false, `${String(bad)} should be invalid`);
  }
});

test('getNextDriverStatus: advances the lifecycle and self-loops terminals', () => {
  assert.equal(getNextDriverStatus(RIDE_STATUS.NEW_ORDER), RIDE_STATUS.ACCEPTED);
  assert.equal(getNextDriverStatus(RIDE_STATUS.ACCEPTED), RIDE_STATUS.DRIVER_EN_ROUTE);
  assert.equal(getNextDriverStatus(RIDE_STATUS.DRIVER_EN_ROUTE), RIDE_STATUS.DRIVER_APPROACHING_PICKUP);
  assert.equal(getNextDriverStatus(RIDE_STATUS.DRIVER_APPROACHING_PICKUP), RIDE_STATUS.WAITING_PASSENGER);
  assert.equal(getNextDriverStatus(RIDE_STATUS.WAITING_PASSENGER), RIDE_STATUS.IN_PROGRESS);
  assert.equal(getNextDriverStatus(RIDE_STATUS.IN_PROGRESS), RIDE_STATUS.COMPLETED);
  // terminals point at themselves; unknown input falls back to itself.
  for (const t of TERMINAL) {
    assert.equal(getNextDriverStatus(RIDE_STATUS[t]), RIDE_STATUS[t]);
  }
  assert.equal(getNextDriverStatus('GARBAGE'), 'GARBAGE');
});

// ── storage-backed invariants (with localStorage mock) ────────────────────────

test('saveActiveRide + find/getActiveRide round-trips by tripId', () => {
  const ride = { tripId: 't1', role: 'driver', status: RIDE_STATUS.ACCEPTED };
  saveActiveRide(ride);
  assert.equal(findActiveRide('t1').status, RIDE_STATUS.ACCEPTED);
  assert.equal(getActiveRide('t1').status, RIDE_STATUS.ACCEPTED);
  assert.equal(findActiveRide('missing'), null);
});

test('saveActiveRide rejects non-objects and rides without a tripId', () => {
  assert.equal(findActiveRide('t1'), null);
  saveActiveRide(null);
  saveActiveRide({ status: RIDE_STATUS.ACCEPTED }); // no tripId
  assert.equal(findActiveRide('t1'), null);
});

test('getActiveRide auto-creates a NEW_ORDER demo for an unknown tripId', () => {
  const ride = getActiveRide('fresh-trip');
  assert.equal(ride.tripId, 'fresh-trip');
  assert.equal(ride.status, RIDE_STATUS.NEW_ORDER);
});

test('terminal freeze: updateActiveRideStatus will not move a terminal ride', () => {
  for (const t of TERMINAL) {
    globalThis.localStorage.clear();
    saveActiveRide({ tripId: 't1', status: RIDE_STATUS[t] });
    const out = updateActiveRideStatus('t1', RIDE_STATUS.IN_PROGRESS, { patched: true });
    assert.equal(out.status, RIDE_STATUS[t], `${t} must stay frozen`);
    assert.equal(findActiveRide('t1').status, RIDE_STATUS[t]);
    assert.equal(out.patched, undefined, 'no patch merge onto a terminal ride');
  }
});

test('terminal freeze: saveActiveRide will not thaw a terminal record to a new status', () => {
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.COMPLETED });
  const out = saveActiveRide({ tripId: 't1', status: RIDE_STATUS.IN_PROGRESS });
  assert.equal(out.status, RIDE_STATUS.COMPLETED);
  assert.equal(findActiveRide('t1').status, RIDE_STATUS.COMPLETED);
});

test('updateActiveRideStatus: invalid status is a no-op', () => {
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.ACCEPTED });
  const out = updateActiveRideStatus('t1', 'GARBAGE');
  assert.equal(out.status, RIDE_STATUS.ACCEPTED);
});

test('updateActiveRideStatus: a terminal write on an unknown trip returns null (no auto-create)', () => {
  assert.equal(updateActiveRideStatus('ghost', RIDE_STATUS.CANCELED), null);
  assert.equal(findActiveRide('ghost'), null);
});

test('updateActiveRideStatus: advances a live non-terminal ride and stamps a timestamp', () => {
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.WAITING_PASSENGER });
  const out = updateActiveRideStatus('t1', RIDE_STATUS.IN_PROGRESS);
  assert.equal(out.status, RIDE_STATUS.IN_PROGRESS);
  assert.equal(typeof out.timestamps.startedAt, 'string');
});

test('cancelActiveRide: stamps CANCELED with the actor, is null on unknown, idempotent on terminal', () => {
  // unknown trip → null, never auto-creates.
  assert.equal(cancelActiveRide({ tripId: 'ghost', canceledBy: 'driver' }), null);
  // live ride → CANCELED with actor + reason.
  saveActiveRide({ tripId: 't1', status: RIDE_STATUS.IN_PROGRESS });
  const cancelled = cancelActiveRide({ tripId: 't1', canceledBy: 'passenger', reason: 'changed_mind' });
  assert.equal(cancelled.status, RIDE_STATUS.CANCELED);
  assert.equal(cancelled.cancel.by, 'passenger');
  assert.equal(cancelled.cancel.reason, 'changed_mind');
  assert.equal(typeof cancelled.timestamps.canceledAt, 'string');
  // idempotent: a second cancel returns the existing terminal record unchanged.
  const again = cancelActiveRide({ tripId: 't1', canceledBy: 'driver' });
  assert.equal(again.cancel.by, 'passenger');
  assert.equal(again.timestamps.canceledAt, cancelled.timestamps.canceledAt);
});

test('cancelActiveRide: missing / non-string tripId returns null', () => {
  for (const bad of [undefined, '', null, 123, {}]) {
    assert.equal(cancelActiveRide({ tripId: bad, canceledBy: 'driver' }), null);
  }
});

// ── BD-RIDE-WAITING-01E final repair — shared legacy waiting-leak normalizer ──
// waiting.remaining/waiting.paidStartsAt are write-once at seed time: nothing
// else in the app ever writes a different value into them. A real Ride
// (non-empty orderId OR non-empty acceptedSource) still carrying the exact
// demo literals '2:30' / '14:18' is therefore, by construction, a stale
// pre-v296 leak. findActiveRide/getActiveRide (read) and saveActiveRide
// (write) share one normalizer in ride_state.js. tripId SHAPE is NOT a
// general-purpose discriminator — an arbitrary non-feed sim tripId with
// neither marker is left untouched, same as the canonical demo. The one
// narrow exception is a feed-* tripId: acceptPassengerRequestFromPost/
// buildRideFromPost used that reserved namespace for REAL marketplace
// accepts before the acceptedSource marker existed, so a pre-existing
// feed-* record with neither marker is still treated as a real-candidate
// (a historical-migration exception, not a general provenance rule).

function legacyRealWaiting() {
  return { freeLimit: '3:00', remaining: '2:30', paidStartsAt: '14:18', paidRate: '8 ₽ за каждую минуту' };
}

test('shared normalizer (read): findActiveRide nulls remaining/paidStartsAt for a legacy real (orderId-marked) ride', () => {
  saveActiveRideStore({
    't-legacy': {
      tripId: 't-legacy', role: 'passenger', status: RIDE_STATUS.WAITING_PASSENGER,
      orderId: 'order-123', waiting: legacyRealWaiting(),
    },
  });
  const found = findActiveRide('t-legacy');
  assert.equal(found.waiting.remaining, null);
  assert.equal(found.waiting.paidStartsAt, null);
  assert.equal(found.waiting.freeLimit, '3:00');
  assert.equal(found.waiting.paidRate, '8 ₽ за каждую минуту');
});

test('shared normalizer (read): a read alone does not rewrite storage — the raw record stays 2:30/14:18 until something writes', () => {
  saveActiveRideStore({
    't-legacy': {
      tripId: 't-legacy', role: 'passenger', status: RIDE_STATUS.WAITING_PASSENGER,
      orderId: 'order-123', waiting: legacyRealWaiting(),
    },
  });
  findActiveRide('t-legacy'); // read-only
  const raw = loadActiveRideStore()['t-legacy'];
  assert.equal(raw.waiting.remaining, '2:30');
  assert.equal(raw.waiting.paidStartsAt, '14:18');
});

test('shared normalizer (write): saveActiveRide persists null/null for a real legacy ride, and returns the normalized copy', () => {
  const out = saveActiveRide({
    tripId: 't-legacy', role: 'passenger', status: RIDE_STATUS.WAITING_PASSENGER,
    orderId: 'order-123', waiting: legacyRealWaiting(),
  });
  assert.equal(out.waiting.remaining, null);
  assert.equal(out.waiting.paidStartsAt, null);
  const raw = loadActiveRideStore()['t-legacy'];
  assert.equal(raw.waiting.remaining, null);
  assert.equal(raw.waiting.paidStartsAt, null);
});

test('shared normalizer (write via transition): updateActiveRideStatus on a legacy real ride leaves storage null/null after the status change', () => {
  saveActiveRideStore({
    't-legacy': {
      tripId: 't-legacy', role: 'driver', status: RIDE_STATUS.DRIVER_APPROACHING_PICKUP,
      orderId: 'order-123', waiting: legacyRealWaiting(),
    },
  });
  const out = updateActiveRideStatus('t-legacy', RIDE_STATUS.WAITING_PASSENGER);
  assert.equal(out.status, RIDE_STATUS.WAITING_PASSENGER);
  assert.equal(out.waiting.remaining, null);
  assert.equal(out.waiting.paidStartsAt, null);
  const raw = loadActiveRideStore()['t-legacy'];
  assert.equal(raw.waiting.remaining, null);
  assert.equal(raw.waiting.paidStartsAt, null);
});

test('C. shared normalizer: DEMO_ACTIVE_RIDE_ID keeps its intentional 2:30/14:18 fixture on read and write', () => {
  const demo = {
    tripId: DEMO_ACTIVE_RIDE_ID, role: 'driver', status: RIDE_STATUS.NEW_ORDER,
    waiting: legacyRealWaiting(),
  };
  saveActiveRideStore({ [DEMO_ACTIVE_RIDE_ID]: demo });
  const found = findActiveRide(DEMO_ACTIVE_RIDE_ID);
  assert.equal(found.waiting.remaining, '2:30');
  assert.equal(found.waiting.paidStartsAt, '14:18');
  const saved = saveActiveRide({ ...demo });
  assert.equal(saved.waiting.remaining, '2:30');
  assert.equal(saved.waiting.paidStartsAt, '14:18');
});

test('D. shared normalizer: an arbitrary NON-feed sim tripId with no orderId/acceptedSource marker keeps 2:30/14:18 untouched', () => {
  const sim = {
    tripId: 'sim-audit-123', role: 'driver', status: RIDE_STATUS.WAITING_PASSENGER,
    waiting: legacyRealWaiting(),
  };
  saveActiveRideStore({ 'sim-audit-123': sim });
  const found = findActiveRide('sim-audit-123');
  assert.equal(found.waiting.remaining, '2:30');
  assert.equal(found.waiting.paidStartsAt, '14:18');
  const saved = saveActiveRide({ ...sim });
  assert.equal(saved.waiting.remaining, '2:30');
  assert.equal(saved.waiting.paidStartsAt, '14:18');
});

// A/B — legacy feed migration: a pre-existing feed-* real ride from before
// acceptedSource existed has no other recoverable signal, so the narrow
// feed- tripId exception normalizes it (not an artificial "stays untouched"
// assumption — that encoded a conservative guess, not an established
// product contract, and left real historical marketplace rides stranded).
test('A. legacy feed migration (read): a pre-existing feed-* real ride with no orderId/acceptedSource normalizes via the narrow migration exception', () => {
  saveActiveRideStore({
    'feed-old-post-123': {
      tripId: 'feed-old-post-123', role: 'driver', status: RIDE_STATUS.NEW_ORDER,
      waiting: legacyRealWaiting(),
    },
  });
  const found = findActiveRide('feed-old-post-123');
  assert.equal(found.waiting.remaining, null);
  assert.equal(found.waiting.paidStartsAt, null);
});

test('B. legacy feed migration (write/transition): the same legacy feed-* record stays null/null through the save and update boundary', () => {
  saveActiveRideStore({
    'feed-old-post-123': {
      tripId: 'feed-old-post-123', role: 'driver', status: RIDE_STATUS.NEW_ORDER,
      waiting: legacyRealWaiting(),
    },
  });
  const saved = saveActiveRide({
    tripId: 'feed-old-post-123', role: 'driver', status: RIDE_STATUS.NEW_ORDER,
    waiting: legacyRealWaiting(),
  });
  assert.equal(saved.waiting.remaining, null);
  assert.equal(saved.waiting.paidStartsAt, null);
  const raw = loadActiveRideStore()['feed-old-post-123'];
  assert.equal(raw.waiting.remaining, null);
  assert.equal(raw.waiting.paidStartsAt, null);

  const advanced = updateActiveRideStatus('feed-old-post-123', RIDE_STATUS.ACCEPTED);
  assert.equal(advanced.status, RIDE_STATUS.ACCEPTED);
  assert.equal(advanced.waiting.remaining, null);
  assert.equal(advanced.waiting.paidStartsAt, null);
});

test('E. shared normalizer: an explicit real orderId normalizes (unchanged behavior)', () => {
  saveActiveRideStore({
    't-orderid': {
      tripId: 't-orderid', role: 'passenger', status: RIDE_STATUS.WAITING_PASSENGER,
      orderId: 'order-999', waiting: legacyRealWaiting(),
    },
  });
  const found = findActiveRide('t-orderid');
  assert.equal(found.waiting.remaining, null);
  assert.equal(found.waiting.paidStartsAt, null);
});

test('F. shared normalizer: a real driver ride marked only by acceptedSource (no orderId) normalizes', () => {
  saveActiveRideStore({
    't-driver': {
      tripId: 't-driver', role: 'driver', status: RIDE_STATUS.ACCEPTED,
      acceptedSource: 'canonical_accept', waiting: legacyRealWaiting(),
    },
  });
  const found = findActiveRide('t-driver');
  assert.equal(found.waiting.remaining, null);
  assert.equal(found.waiting.paidStartsAt, null);
});

test('shared normalizer: the feed/marketplace accept ride normalizes via acceptedSource === \'feed_post_accept\' (not tripId shape)', () => {
  saveActiveRideStore({
    'feed-99': {
      tripId: 'feed-99', role: 'driver', status: RIDE_STATUS.NEW_ORDER,
      acceptedSource: 'feed_post_accept', waiting: legacyRealWaiting(),
    },
  });
  const found = findActiveRide('feed-99');
  assert.equal(found.waiting.remaining, null);
  assert.equal(found.waiting.paidStartsAt, null);
});

test('H. getActiveRide: an existing real record is normalized; a missing record still auto-creates a demo untouched', () => {
  saveActiveRideStore({
    't-legacy': {
      tripId: 't-legacy', role: 'passenger', status: RIDE_STATUS.WAITING_PASSENGER,
      orderId: 'order-123', waiting: legacyRealWaiting(),
    },
  });
  const existing = getActiveRide('t-legacy');
  assert.equal(existing.waiting.remaining, null);
  assert.equal(existing.waiting.paidStartsAt, null);

  const created = getActiveRide('brand-new-trip');
  assert.equal(created.tripId, 'brand-new-trip');
  assert.equal(created.status, RIDE_STATUS.NEW_ORDER);
  // fresh auto-create carries no orderId/acceptedSource marker, so it is
  // not a real-ride candidate — the demo base's own literal is untouched.
  assert.equal(created.waiting.remaining, '2:30');
});

// ── terminal freeze interaction: blocked transitions must not thaw status
// or re-surface stale demo waiting on the returned Ride ──────────────────
test('terminal freeze + normalizer: updateActiveRideStatus on a terminal legacy real ride does not thaw status and does not re-surface stale demo waiting', () => {
  saveActiveRideStore({
    't-legacy': {
      tripId: 't-legacy', role: 'passenger', status: RIDE_STATUS.COMPLETED,
      orderId: 'order-123', waiting: legacyRealWaiting(),
    },
  });
  const out = updateActiveRideStatus('t-legacy', RIDE_STATUS.IN_PROGRESS, { patched: true });
  assert.equal(out.status, RIDE_STATUS.COMPLETED, 'terminal status must not thaw');
  assert.equal(out.waiting.remaining, null);
  assert.equal(out.waiting.paidStartsAt, null);
  assert.equal(out.patched, undefined, 'no patch merge onto a terminal ride');
});

test('terminal freeze + normalizer: saveActiveRide refuses a forbidden transition on a terminal legacy real ride, returns it normalized, and does not persist the normalization on the frozen path', () => {
  saveActiveRideStore({
    't-legacy': {
      tripId: 't-legacy', role: 'passenger', status: RIDE_STATUS.COMPLETED,
      orderId: 'order-123', waiting: legacyRealWaiting(),
    },
  });
  const out = saveActiveRide({ tripId: 't-legacy', status: RIDE_STATUS.IN_PROGRESS, orderId: 'order-123' });
  assert.equal(out.status, RIDE_STATUS.COMPLETED, 'terminal status must not thaw');
  assert.equal(out.waiting.remaining, null);
  assert.equal(out.waiting.paidStartsAt, null);
  const raw = loadActiveRideStore()['t-legacy'];
  assert.equal(raw.status, RIDE_STATUS.COMPLETED);
  assert.equal(raw.waiting.remaining, '2:30',
    'the frozen path is non-persisting — storage stays raw until a legitimate write happens');
});
