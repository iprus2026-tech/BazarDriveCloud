// /server/src/domain/receipt-amounts.js — server-derived receipt amounts (BD-RIDE-AUTHORITY-01B-C;
// docs/ride-state-receipt-authority-contract.md §3). Pure: no I/O.
//
// INTERIM fare basis, not final fare truth: until the Route & Price authority (BD-DOCS-035 / #588)
// provides an authoritative fare fact, the fare is the price fixed server-side when the passenger
// selected the driver — the accepted offer's price, else the order estimate. Client-supplied
// fare / commission / tip / net are never used. There is no tip workflow, so tip is always 0.

// Half-up rounding to whole rubles. The tiny epsilon keeps an exact .5 that floating point
// represents as .4999… (e.g. fare × a decimal percent) from rounding down.
export function roundHalfUp(value) {
  return Math.floor(value + 0.5 + 1e-9);
}

// offerPrice / orderEstimate arrive as pg NUMERIC strings (or numbers, or null).
// Returns { ok: true, amounts: { fare, commission, tip, net }, basis } or { ok: false, code }.
export function computeReceiptAmounts({ offerPrice, orderEstimate, commissionPercent }) {
  const useOffer = offerPrice !== null && offerPrice !== undefined;
  const raw = useOffer ? offerPrice : orderEstimate;
  const basis = raw === null || raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(basis) || basis <= 0) return { ok: false, code: 'RECEIPT_FARE_UNKNOWN' };
  if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
    throw new Error(`computeReceiptAmounts: invalid commissionPercent ${commissionPercent}`);
  }
  const fare = roundHalfUp(basis);
  // `0 - x`, not `-x`: a 0% commission must be +0, never -0.
  const commission = 0 - roundHalfUp((fare * commissionPercent) / 100);
  const tip = 0;
  return {
    ok: true,
    amounts: { fare, commission, tip, net: fare + commission + tip },
    basis: useOffer ? 'accepted_offer' : 'order_estimate',
  };
}
