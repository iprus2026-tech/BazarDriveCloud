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

test('deriveWaitCountdown: one second before deadline -> FREE_WAIT / 0:01', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 179_000);
  assert.equal(out.phase, 'FREE_WAIT');
  assert.equal(out.remaining, '0:01');
  assert.equal(out.paidElapsed, '0:00');
});

test('deriveWaitCountdown: exact deadline -> PAID_WAIT / 0:00', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 180_000);
  assert.equal(out.phase, 'PAID_WAIT');
  assert.equal(out.remaining, '0:00');
  assert.equal(out.paidElapsed, '0:00');
  assert.equal(out.paidElapsedSec, 0);
  assert.equal(out.pct, 0);
});

test('deriveWaitCountdown: one second after deadline -> PAID_WAIT / paid 0:01', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 181_000);
  assert.equal(out.phase, 'PAID_WAIT');
  assert.equal(out.remaining, '0:00');
  assert.equal(out.paidElapsed, '0:01');
  assert.equal(out.paidElapsedSec, 1);
  assert.equal(out.pct, 0);
});

test('deriveWaitCountdown: sixty seconds after deadline -> paid 1:00', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 240_000);
  assert.equal(out.phase, 'PAID_WAIT');
  assert.equal(out.paidElapsed, '1:00');
  assert.equal(out.paidElapsedSec, 60);
});

test('deriveWaitCountdown: well after deadline stays bounded and carries no monetary accrual', () => {
  const out = deriveWaitCountdown(ARRIVED_MS, FREE_LIMIT_SEC, ARRIVED_MS + 999_000);
  assert.equal(out.phase, 'PAID_WAIT');
  assert.equal(out.remaining, '0:00');
  assert.equal(out.pct, 0);
  assert.equal(Object.hasOwn(out, 'accrued'), false);
  assert.equal(Object.hasOwn(out, 'amount'), false);
  assert.equal(Object.hasOwn(out, 'cost'), false);
});

test('deriveWaitCountdown: pct is the exact bounded percentage, not pre-rounded — progress-bar step matches active_ride.js\'s single-pass driver formula (code-review fix)', () => {
  // Regression case from the confirmed P2: freeLimitSec=300, remainingSec=14.
  // Driver (active_ride.js): step = Math.round((remainingSec / freeLimitSec) * 10) = 0.
  // Old passenger bug: pct pre-rounded to Math.round(14/300*100) = 5, then
  // Math.round(5 / 10) = 1 — a different, wrong step for the same ride.
  const freeLimitSec = 300;
  const remainingSec = 14;
  const nowMs = ARRIVED_MS + (freeLimitSec - remainingSec) * 1000;
  const out = deriveWaitCountdown(ARRIVED_MS, freeLimitSec, nowMs);
  const driverStep = Math.round((remainingSec / freeLimitSec) * 10);
  const passengerStep = Math.round(out.pct / 10);
  assert.equal(driverStep, 0);
  assert.equal(passengerStep, 0);
  assert.equal(passengerStep, driverStep);
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

test('waitingInfo: missing arrivedAt -> honest "-" / pct null and no invented paid phase', () => {
  const ride = realRide({ timestamps: { arrivedAt: null } });
  const w = waitingInfo(ride, ARRIVED_MS);
  assert.equal(w.phase, null);
  assert.equal(w.remaining, '—');
  assert.equal(w.paidElapsed, '—');
  assert.equal(w.paidElapsedSec, null);
  assert.equal(w.paidStartsAt, '—');
  assert.equal(w.pct, null);
});

test('waitingInfo: invalid arrivedAt -> same truthful fallback as missing, no PAID_WAIT', () => {
  const ride = realRide({ timestamps: { arrivedAt: 'not-a-real-timestamp' } });
  const w = waitingInfo(ride, ARRIVED_MS);
  assert.equal(w.phase, null);
  assert.equal(w.remaining, '—');
  assert.equal(w.paidElapsed, '—');
  assert.equal(w.paidElapsedSec, null);
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

test('waitingInfo: paidStartsAt derives from the deadline and stays fixed across FREE_WAIT -> PAID_WAIT', () => {
  const ride = realRide();
  const early = waitingInfo(ride, ARRIVED_MS + 10_000);
  const late = waitingInfo(ride, ARRIVED_MS + 240_000);
  assert.equal(early.phase, 'FREE_WAIT');
  assert.equal(late.phase, 'PAID_WAIT');
  assert.equal(early.paidStartsAt, late.paidStartsAt);
});

test('waitingInfo: pure paid-wait derivation does not mutate ride/status and produces no money amount', () => {
  const ride = realRide();
  const before = JSON.stringify(ride);
  const w = waitingInfo(ride, ARRIVED_MS + 240_000);
  assert.equal(w.phase, 'PAID_WAIT');
  assert.equal(ride.status, 'WAITING_PASSENGER');
  assert.equal(JSON.stringify(ride), before);
  assert.equal(Object.hasOwn(w, 'accrued'), false);
  assert.equal(Object.hasOwn(w, 'amount'), false);
  assert.equal(Object.hasOwn(w, 'cost'), false);
});

test('waitingInfo: default nowMs (no third… second argument) still returns a live derivation', () => {
  const ride = realRide({ timestamps: { arrivedAt: new Date().toISOString() } });
  const w = waitingInfo(ride);
  assert.notEqual(w.pct, null);
  assert.ok(w.pct >= 0 && w.pct <= 100);
});
