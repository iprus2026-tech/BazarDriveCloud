// BD-TEST-02 — node:test coverage for the driver readiness rule (state.js).
//
// isDriverLineReady is the single source of truth gating "go online" / accept on
// /driver-map (BD-DRIVER-02) and is the rule the Presence (BD-DOCS-033),
// Dispatch (BD-DOCS-034), and Safety & Compliance (BD-DOCS-037) ADRs all defer
// to. These predicates are pure functions of their argument — no storage, no
// DOM — so they test directly without a mock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  REGISTRATION_DOCS,
  SHIFT_DOCS,
  REQUIRED_DOCS,
  computeDocumentsReady,
  computeShiftDocsReady,
  computeTaxiPermit,
  documentsAttentionCount,
  documentsReviewCount,
  canShowReadyStatus,
  isDriverLineReady,
} from '../public/src/state.js';

// docs map where every key has the given status.
function docsAll(status) {
  const d = {};
  for (const k of REQUIRED_DOCS) d[k] = { status };
  return d;
}
// docs map, all uploaded, then override specific keys.
function docsWith(overrides = {}) {
  const d = docsAll('uploaded');
  for (const [k, status] of Object.entries(overrides)) d[k] = { status };
  return d;
}

const FULL_DRIVER = {
  phone: '+7 900 000-00-00',
  vehicleMake: 'Kia',
  vehicleModel: 'Rio',
  vehiclePlate: 'A123BC',
  documentsReady: true,
  waybillOpen: true,
  medicalCheckPassed: true,
};

// ── document-set shape ────────────────────────────────────────────────────────

test('document sets: registration ⊂ required, shift = required \\ registration', () => {
  assert.deepEqual(REGISTRATION_DOCS, ['driverLicense', 'taxiOsago', 'taxiRegistry']);
  assert.deepEqual(SHIFT_DOCS, ['waybill', 'medicalCheck']);
  assert.deepEqual(REQUIRED_DOCS, [...REGISTRATION_DOCS, ...SHIFT_DOCS]);
});

// ── computeDocumentsReady (registration-only readiness) ───────────────────────

test('computeDocumentsReady: registration docs uploaded/review_required → true', () => {
  assert.equal(computeDocumentsReady(docsAll('uploaded')), true);
  assert.equal(computeDocumentsReady(docsWith({ taxiOsago: 'review_required' })), true);
  // shift docs may still be pending — registration readiness ignores them.
  assert.equal(computeDocumentsReady(docsWith({ waybill: 'missing', medicalCheck: 'draft' })), true);
});

test('computeDocumentsReady: any registration doc expired/missing/draft → false; null → false', () => {
  for (const blocking of ['expired', 'missing', 'draft']) {
    assert.equal(computeDocumentsReady(docsWith({ driverLicense: blocking })), false, blocking);
  }
  assert.equal(computeDocumentsReady(null), false);
  assert.equal(computeDocumentsReady(undefined), false);
});

// ── computeShiftDocsReady (full readiness) ────────────────────────────────────

test('computeShiftDocsReady: needs ALL docs ready, including shift docs', () => {
  assert.equal(computeShiftDocsReady(docsAll('uploaded')), true);
  assert.equal(computeShiftDocsReady(docsWith({ medicalCheck: 'review_required' })), true);
  assert.equal(computeShiftDocsReady(docsWith({ waybill: 'missing' })), false);
  assert.equal(computeShiftDocsReady(null), false);
});

// ── computeTaxiPermit ─────────────────────────────────────────────────────────

test('computeTaxiPermit: true only when taxiRegistry is uploaded', () => {
  assert.equal(computeTaxiPermit(docsWith({ taxiRegistry: 'uploaded' })), true);
  assert.equal(computeTaxiPermit(docsWith({ taxiRegistry: 'review_required' })), false);
  assert.equal(computeTaxiPermit(docsWith({ taxiRegistry: 'missing' })), false);
  assert.equal(computeTaxiPermit(null), false);
});

// ── attention / review counts ─────────────────────────────────────────────────

test('documentsAttentionCount: counts expired/missing/draft, not review_required', () => {
  assert.equal(documentsAttentionCount(docsAll('uploaded')), 0);
  assert.equal(documentsAttentionCount(docsAll('review_required')), 0);
  assert.equal(
    documentsAttentionCount(docsWith({ driverLicense: 'expired', waybill: 'missing', medicalCheck: 'draft' })),
    3,
  );
  assert.equal(documentsAttentionCount(null), 0);
});

test('documentsReviewCount: counts only review_required', () => {
  assert.equal(documentsReviewCount(docsAll('uploaded')), 0);
  assert.equal(documentsReviewCount(docsWith({ taxiOsago: 'review_required', medicalCheck: 'review_required' })), 2);
  assert.equal(documentsReviewCount(null), 0);
});

// ── canShowReadyStatus (profile completeness) ─────────────────────────────────

test('canShowReadyStatus: true only with phone + full vehicle identity', () => {
  assert.equal(canShowReadyStatus(FULL_DRIVER), true);
  assert.equal(canShowReadyStatus(null), false);
  for (const k of ['phone', 'vehicleMake', 'vehicleModel', 'vehiclePlate']) {
    const u = { ...FULL_DRIVER, [k]: '' };
    assert.equal(canShowReadyStatus(u), false, `missing ${k} should block`);
  }
});

// ── isDriverLineReady (the gate) ──────────────────────────────────────────────

test('isDriverLineReady: true only when profile + docs + waybill + medical all hold', () => {
  assert.equal(isDriverLineReady(FULL_DRIVER), true);
  assert.equal(isDriverLineReady(null), false);
  assert.equal(isDriverLineReady({ ...FULL_DRIVER, documentsReady: false }), false);
  assert.equal(isDriverLineReady({ ...FULL_DRIVER, waybillOpen: false }), false);
  assert.equal(isDriverLineReady({ ...FULL_DRIVER, medicalCheckPassed: false }), false);
  assert.equal(isDriverLineReady({ ...FULL_DRIVER, vehiclePlate: '' }), false);
});

test('isDriverLineReady: strict === true — truthy-but-not-true flags do not pass', () => {
  // Guards against a loosened gate: 1 / "true" / "yes" must not satisfy it.
  assert.equal(isDriverLineReady({ ...FULL_DRIVER, waybillOpen: 1 }), false);
  assert.equal(isDriverLineReady({ ...FULL_DRIVER, documentsReady: 'true' }), false);
  assert.equal(isDriverLineReady({ ...FULL_DRIVER, medicalCheckPassed: 'yes' }), false);
});
