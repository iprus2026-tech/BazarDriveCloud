// /server/test/receipt-amounts.test.mjs — hermetic unit tests for the server-derived receipt
// amounts (BD-RIDE-AUTHORITY-01B-C; docs/ride-state-receipt-authority-contract.md §3).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeReceiptAmounts, roundHalfUp } from '../src/domain/receipt-amounts.js';

const amounts = (input) => {
  const r = computeReceiptAmounts({ commissionPercent: 12, ...input });
  assert.equal(r.ok, true, JSON.stringify(input));
  return r;
};

test('fare comes from the accepted offer price, else the order estimate', () => {
  assert.deepEqual(amounts({ offerPrice: '763.00', orderEstimate: '301.00' }),
    { ok: true, amounts: { fare: 763, commission: -92, tip: 0, net: 671 }, basis: 'accepted_offer' });
  assert.deepEqual(amounts({ offerPrice: null, orderEstimate: '800.00' }),
    { ok: true, amounts: { fare: 800, commission: -96, tip: 0, net: 704 }, basis: 'order_estimate' });
  assert.deepEqual(amounts({ offerPrice: 850, orderEstimate: 0 }).amounts, { fare: 850, commission: -102, tip: 0, net: 748 });
});

test('a missing or non-positive basis is RECEIPT_FARE_UNKNOWN', () => {
  for (const input of [
    { offerPrice: null, orderEstimate: null },
    { offerPrice: null, orderEstimate: '0.00' },
    { offerPrice: undefined, orderEstimate: undefined },
    { offerPrice: '0.00', orderEstimate: '800.00' },
    { offerPrice: 'not-a-number', orderEstimate: '800.00' },
  ]) {
    assert.deepEqual(computeReceiptAmounts({ commissionPercent: 12, ...input }), { ok: false, code: 'RECEIPT_FARE_UNKNOWN' },
      JSON.stringify(input));
  }
});

test('fare and commission round half up to whole rubles', () => {
  assert.deepEqual(amounts({ offerPrice: '763.50' }).amounts, { fare: 764, commission: -92, tip: 0, net: 672 });
  assert.deepEqual(amounts({ offerPrice: '763.49' }).amounts.fare, 763);
  assert.equal(computeReceiptAmounts({ offerPrice: 1625, commissionPercent: 10 }).amounts.commission, -163);
  assert.equal(computeReceiptAmounts({ offerPrice: 1000, commissionPercent: 12.5 }).amounts.commission, -125);
  assert.equal(roundHalfUp(2.5), 3);
  assert.equal(roundHalfUp(2.4999), 2);
  assert.equal(roundHalfUp(0), 0);
});

test('commission bounds: 0% is +0 (never -0), 100% leaves net 0, tip is always 0', () => {
  const zero = computeReceiptAmounts({ offerPrice: 500, commissionPercent: 0 });
  assert.ok(Object.is(zero.amounts.commission, 0), 'a 0% commission is +0');
  assert.deepEqual(zero.amounts, { fare: 500, commission: 0, tip: 0, net: 500 });
  assert.deepEqual(computeReceiptAmounts({ offerPrice: 500, commissionPercent: 100 }).amounts,
    { fare: 500, commission: -500, tip: 0, net: 0 });
});

test('an invalid commissionPercent is a programming error', () => {
  for (const pct of [-1, 101, Number.NaN, undefined]) {
    assert.throws(() => computeReceiptAmounts({ offerPrice: 500, commissionPercent: pct }), /invalid commissionPercent/);
  }
});
