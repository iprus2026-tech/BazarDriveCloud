// BD-RIDE-PASSENGER-WAIT-COUNTDOWN-01A — node:test coverage for #911's live
// free-wait derivation (active_ride_passenger.js's deriveWaitCountdown() and
// waitingInfo()). Pure functions only: an injected nowMs drives every case,
// never a monkey-patched Date. No DOM, no storage, no backend, no timers —
// this file proves the math and the ride -> presentation mapping in
// isolation; scripts/smoke-ride-waiting-legacy-repair.mjs proves the
// surrounding structural contract (single setInterval, LOCAL_ONLY/
// SERVER_BACKED tick shape) since that already reads this screen's full
// source the same way for its neighboring #912 coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveWaitCountdown,
  waitingInfo,
} from '../public/src/screens/active_ride_passenger.js';
import { DEFAULT_FREE_WAIT_LIMIT, DEFAULT_PAID_RATE_LABEL } from '../public/src/ride_waiting_policy.js';

const ARRIVED_AT = '2026-01-01T12:00:00.000Z';
const ARRIVED_MS = Date.parse(ARRIVED_AT);
const FREE_LIMIT_SEC = 180; // '3:00'

function realRide(overrides = {}) {
  return {
    tripId: 'trip_countdown_1',
    orderId: 'order_countdown_1',
    status: 'WAITING_PASSENGER',
    timestamps: { arrivedAt: ARRIVED_AT },
    waiting: { freeLimit: null, remaining: null, paidStartsAt: null, paidRate: null },
    ...overrides,
  };
}

// ── deriveWaitCountdown — pure math, items 1-5 ──────────────────────────────

test('deriveWaitCountdown: now == arrivedAt -> full free limit', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS);
  assert.equal(out.remaining, '3:00');
  assert.equal(out.pct, 100);
});

test('deriveWaitCountdown: midpoint -> correct M:SS and pct', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 90_000);
  assert.equal(out.remaining, '1:30');
  assert.equal(out.pct, 50);
});

test('deriveWaitCountdown: one second before deadline -> 0:01', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 179_000);
  assert.equal(out.remaining, '0:01');
});

test('deriveWaitCountdown: exact deadline -> 0:00, pct 0', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 180_000);
  assert.equal(out.remaining, '0:00');
  assert.equal(out.pct, 0);
});

test('deriveWaitCountdown: after deadline -> stays 0:00, pct 0 (never negative)', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 999_000);
  assert.equal(out.remaining, '0:00');
  assert.equal(out.pct, 0);
});

test('deriveWaitCountdown: paidStartsAt is the deadline clock, not "now" — stays fixed after deadline', () => {
  const atDeadline = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 180_000);
  const wellAfter = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 999_000);
  assert.equal(atDeadline.paidStartsAt, wellAfter.paidStartsAt);
  assert.match(atDeadline.paidStartsAt, /^\d{2}:\d{2}$/);
});

// ── waitingInfo — ride -> presentation mapping, items 6-10 ─────────────────

test('waitingInfo: valid arrivedAt derives live remaining/pct from nowMs', () => {
  const w = waitingInfo(realRide(), ARRIVED_MS + 90_000);
  assert.equal(w.remaining, '1:30');
  assert.equal(w.pct, 50);
});

test('waitingInfo: missing arrivedAt -> honest "-" / pct null (no invented clock)', () => {
  const ride = realRide({ timestamps: { arrivedAt: null } });
  const w = waitingInfo(ride, ARRIVED_MS);
  assert.equal(w.remaining, '—');
  assert.equal(w.paidStartsAt, '—');
  assert.equal(w.pct, null);
});

test('waitingInfo: invalid arrivedAt -> same truthful fallback as missing', () => {
  const ride = realRide({ timestamps: { arrivedAt: 'not-a-real-timestamp' } });
  const w = waitingInfo(ride, ARRIVED_MS);
  assert.equal(w.remaining, '—');
  assert.equal(w.paidStartsAt, '—');
  assert.equal(w.pct, null);
});

test('waitingInfo: missing arrivedAt preserves an existing demo/fixture waiting.remaining instead of forcing "-"', () => {
  // Mirrors buildDemoRide()'s own literal snapshot / an explicit sim
  // override — must not regress to '—' for a ride that already carries its
  // own intentional fixture values (no arrivedAt stamped by design).
  const ride = realRide({
    timestamps: { arrivedAt: null },
    waiting: { freeLimit: '3:00', remaining: '2:30', paidStartsAt: '14:18', paidRate: '8 ₽ за каждую минуту' },
  });
  const w = waitingInfo(ride, ARRIVED_MS);
  assert.equal(w.remaining, '2:30');
  assert.equal(w.paidStartsAt, '14:18');
});

test('waitingInfo: custom valid freeLimit -> deadline math uses it, not the default', () => {
  const ride = realRide({ waiting: { freeLimit: '5:00', remaining: null, paidStartsAt: null, paidRate: null } });
  const w = waitingInfo(ride, ARRIVED_MS); // t=0 of a 5:00 window
  assert.equal(w.remaining, '5:00');
  assert.equal(w.freeLimit, '5:00');
});

test('waitingInfo: missing freeLimit -> falls back to DEFAULT_FREE_WAIT_LIMIT', () => {
  const w = waitingInfo(realRide(), ARRIVED_MS);
  assert.equal(w.freeLimit, DEFAULT_FREE_WAIT_LIMIT);
  assert.equal(w.remaining, DEFAULT_FREE_WAIT_LIMIT); // t=0 of the default window
});

test('waitingInfo: paidRate still resolves to DEFAULT_PAID_RATE_LABEL when absent (policy untouched by #911)', () => {
  const w = waitingInfo(realRide(), ARRIVED_MS);
  assert.equal(w.paidRate, DEFAULT_PAID_RATE_LABEL);
});

test('waitingInfo: paidStartsAt derives from the deadline, not from nowMs advancing', () => {
  const ride = realRide();
  const early = waitingInfo(ride, ARRIVED_MS + 10_000);
  const late = waitingInfo(ride, ARRIVED_MS + 170_000);
  assert.equal(early.paidStartsAt, late.paidStartsAt);
});

test('waitingInfo: default nowMs (no third… second argument) still returns a live derivation', () => {
  const ride = realRide({ timestamps: { arrivedAt: new Date().toISOString() } });
  const w = waitingInfo(ride);
  assert.notEqual(w.pct, null);
  assert.ok(w.pct >= 0 && w.pct <= 100);
});
