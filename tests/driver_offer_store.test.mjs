// BD-TEST-03 — node:test coverage for the DriverOffer store (driver_offer_store.js).
//
// The offer lifecycle behind Phase 3 dispatch/matching (BD-DOCS-034): idempotent
// send, withdraw, and the atomic passenger commit (chosen → accepted, peers →
// rejected, order overlay → ACCEPTED). The module falls back to an in-memory
// store when localStorage is absent (the node:test case), so no mock is needed —
// clearDriverOfferStore() resets both the offer and overlay stores between tests.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DRIVER_OFFER_STATUS,
  sendDriverOffer,
  withdrawDriverOffer,
  getDriverOffer,
  listDriverOffersForOrder,
  commitPassengerSelection,
  getOrderOverlay,
  clearDriverOfferStore,
} from '../public/src/driver_offer_store.js';

const O = 'order-1';
const A = 'drvA';
const B = 'drvB';
const BLOCKED = ['__proto__', 'constructor', 'prototype'];

beforeEach(() => { clearDriverOfferStore(); });

// ── sendDriverOffer ───────────────────────────────────────────────────────────

test('sendDriverOffer: new offer is sent, well-formed, and expires after createdAt', () => {
  const off = sendDriverOffer({ orderId: O, driverId: A });
  assert.equal(off.status, DRIVER_OFFER_STATUS.SENT);
  assert.equal(off.id, `offer_${O}_${A}`);
  assert.equal(off.orderId, O);
  assert.equal(off.driverId, A);
  assert.equal(typeof off.createdAt, 'string');
  assert.equal(typeof off.expiresAt, 'string');
  assert.ok(new Date(off.expiresAt).getTime() > new Date(off.createdAt).getTime(),
    'expiresAt must be after createdAt');
});

test('sendDriverOffer: idempotent while sent — same offer, createdAt preserved', () => {
  const first = sendDriverOffer({ orderId: O, driverId: A });
  const again = sendDriverOffer({ orderId: O, driverId: A });
  assert.equal(again.status, DRIVER_OFFER_STATUS.SENT);
  assert.equal(again.createdAt, first.createdAt);
  assert.equal(listDriverOffersForOrder(O).length, 1, 'no duplicate offer');
});

test('sendDriverOffer: re-send after withdraw flips back to sent, keeps createdAt', () => {
  const first = sendDriverOffer({ orderId: O, driverId: A });
  withdrawDriverOffer({ orderId: O, driverId: A });
  const resent = sendDriverOffer({ orderId: O, driverId: A });
  assert.equal(resent.status, DRIVER_OFFER_STATUS.SENT);
  assert.equal(resent.createdAt, first.createdAt);
});

test('sendDriverOffer: blocked / unsafe keys return null (prototype-pollution guard)', () => {
  for (const bad of BLOCKED) {
    assert.equal(sendDriverOffer({ orderId: bad, driverId: A }), null, `orderId ${bad}`);
    assert.equal(sendDriverOffer({ orderId: O, driverId: bad }), null, `driverId ${bad}`);
  }
  assert.equal(sendDriverOffer({ orderId: '', driverId: A }), null);
  assert.equal(sendDriverOffer({}), null);
  // Object.prototype must stay clean.
  assert.equal(({}).polluted, undefined);
});

// ── withdrawDriverOffer ───────────────────────────────────────────────────────

test('withdrawDriverOffer: sent → withdrawn; idempotent; null on unknown/unsafe', () => {
  sendDriverOffer({ orderId: O, driverId: A });
  const w = withdrawDriverOffer({ orderId: O, driverId: A });
  assert.equal(w.status, DRIVER_OFFER_STATUS.WITHDRAWN);
  // idempotent: withdrawing again returns the withdrawn record verbatim.
  const w2 = withdrawDriverOffer({ orderId: O, driverId: A });
  assert.equal(w2.status, DRIVER_OFFER_STATUS.WITHDRAWN);
  // unknown / unsafe → null.
  assert.equal(withdrawDriverOffer({ orderId: O, driverId: 'ghost' }), null);
  assert.equal(withdrawDriverOffer({ orderId: BLOCKED[0], driverId: A }), null);
});

// ── reads ─────────────────────────────────────────────────────────────────────

test('getDriverOffer / listDriverOffersForOrder: read back, unknowns are null / []', () => {
  sendDriverOffer({ orderId: O, driverId: A });
  sendDriverOffer({ orderId: O, driverId: B });
  assert.equal(getDriverOffer(O, A).driverId, A);
  assert.equal(getDriverOffer(O, 'ghost'), null);
  assert.equal(getDriverOffer(BLOCKED[1], A), null);
  assert.equal(listDriverOffersForOrder(O).length, 2);
  assert.deepEqual(listDriverOffersForOrder('order-none'), []);
  assert.deepEqual(listDriverOffersForOrder(BLOCKED[2]), []);
});

// ── commitPassengerSelection (atomic select) ──────────────────────────────────

test('commitPassengerSelection: chosen → accepted, peers → rejected, overlay ACCEPTED', () => {
  sendDriverOffer({ orderId: O, driverId: A });
  sendDriverOffer({ orderId: O, driverId: B });
  const allOffers = listDriverOffersForOrder(O);
  const accepted = commitPassengerSelection({ orderId: O, selectedDriverId: A, allOffers });

  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.driverId, A);
  assert.equal(getDriverOffer(O, A).status, 'accepted');
  assert.equal(getDriverOffer(O, B).status, 'rejected');

  const overlay = getOrderOverlay(O);
  assert.equal(overlay.status, 'ACCEPTED');
  assert.equal(overlay.selectedDriverId, A);
});

test('commitPassengerSelection: validation failures return null and write nothing', () => {
  sendDriverOffer({ orderId: O, driverId: A });
  const allOffers = listDriverOffersForOrder(O);
  // bad inputs
  assert.equal(commitPassengerSelection({ orderId: BLOCKED[0], selectedDriverId: A, allOffers }), null);
  assert.equal(commitPassengerSelection({ orderId: O, selectedDriverId: BLOCKED[0], allOffers }), null);
  assert.equal(commitPassengerSelection({ orderId: O, selectedDriverId: A, allOffers: 'nope' }), null);
  // target not present in the snapshot
  assert.equal(commitPassengerSelection({ orderId: O, selectedDriverId: 'ghost', allOffers }), null);
  // nothing committed: offer still sent, no overlay
  assert.equal(getDriverOffer(O, A).status, DRIVER_OFFER_STATUS.SENT);
  assert.equal(getOrderOverlay(O), null);
});

test('commitPassengerSelection: stale target (store no longer sent) fails wholesale', () => {
  sendDriverOffer({ orderId: O, driverId: A });
  sendDriverOffer({ orderId: O, driverId: B });
  // The store baseline for A is withdrawn, but the caller's snapshot is stale.
  withdrawDriverOffer({ orderId: O, driverId: A });
  const staleSnapshot = [
    { orderId: O, driverId: A, status: 'sent' },
    { orderId: O, driverId: B, status: 'sent' },
  ];
  const out = commitPassengerSelection({ orderId: O, selectedDriverId: A, allOffers: staleSnapshot });
  assert.equal(out, null, 'commit must fail when the target baseline is not sent');
  // store untouched: A stays withdrawn, B stays sent, no overlay.
  assert.equal(getDriverOffer(O, A).status, DRIVER_OFFER_STATUS.WITHDRAWN);
  assert.equal(getDriverOffer(O, B).status, DRIVER_OFFER_STATUS.SENT);
  assert.equal(getOrderOverlay(O), null);
});

test('commitPassengerSelection: an accepted offer is terminal — sendDriverOffer will not revert it', () => {
  sendDriverOffer({ orderId: O, driverId: A });
  const allOffers = listDriverOffersForOrder(O);
  commitPassengerSelection({ orderId: O, selectedDriverId: A, allOffers });
  assert.equal(getDriverOffer(O, A).status, 'accepted');
  // 01D-1 send never overwrites a terminal status.
  const out = sendDriverOffer({ orderId: O, driverId: A });
  assert.equal(out.status, 'accepted');
});
