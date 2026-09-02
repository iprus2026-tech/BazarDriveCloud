// Pure projection tests for BD-DRIVER-DOCUMENT-COMPLIANCE-01B (#955).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DRIVER_DOCUMENT_TYPES,
  buildDriverComplianceProjection,
} from '../src/domain/driver-compliance.js';

const DRIVER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-09-03T12:00:00.000Z');

function row(documentType, status = 'VALID', overrides = {}) {
  return {
    id: `${documentType.toLowerCase()}-row`,
    driver_id: DRIVER_ID,
    document_type: documentType,
    status,
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_until: '2027-01-01T00:00:00.000Z',
    issued_at: '2025-12-01T00:00:00.000Z',
    verified_at: '2026-01-02T00:00:00.000Z',
    verification_source: 'test-verifier',
    verification_reason: null,
    object_key: `private/${documentType.toLowerCase()}`,
    updated_at: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const project = (rows) => buildDriverComplianceProjection(rows, {
  driverId: DRIVER_ID,
  evaluatedAt: NOW,
});

test('absence is synthesized as five deterministic MISSING documents', () => {
  const result = project([]);
  assert.deepEqual(result.documents.map((d) => d.type), DRIVER_DOCUMENT_TYPES);
  assert.deepEqual(result.documents.map((d) => d.status), Array(5).fill('MISSING'));
  assert.deepEqual(result.documents.map((d) => d.scope), [
    'LONG_LIVED', 'LONG_LIVED', 'LONG_LIVED', 'SHIFT', 'SHIFT',
  ]);
  assert.equal(result.documentsReady, false);
  assert.equal(result.shiftReady, false);
  assert.equal(result.lineReady, false);
  assert.deepEqual(result.blockingReasons, DRIVER_DOCUMENT_TYPES.map((t) => `${t}_MISSING`));
  assert.deepEqual(result.warnings, []);
  assert.equal(result.evaluatedAt, NOW.toISOString());
});

test('all current VALID documents produce the server line-ready verdict', () => {
  const result = project(DRIVER_DOCUMENT_TYPES.map((type) => row(type)));
  assert.equal(result.documentsReady, true);
  assert.equal(result.shiftReady, true);
  assert.equal(result.lineReady, true);
  assert.deepEqual(result.blockingReasons, []);
  assert.deepEqual(result.warnings, []);
});

test('EXPIRING remains ready but produces a deterministic warning', () => {
  const rows = DRIVER_DOCUMENT_TYPES.map((type) => row(type));
  rows[0] = row('DRIVER_LICENSE', 'EXPIRING', {
    valid_until: '2026-09-10T00:00:00.000Z',
  });
  const result = project(rows);
  assert.equal(result.lineReady, true);
  assert.deepEqual(result.blockingReasons, []);
  assert.deepEqual(result.warnings, ['DRIVER_LICENSE_EXPIRING_SOON']);
});

test('elapsed VALID/EXPIRING evidence is projected fail-closed as EXPIRED', () => {
  const rows = DRIVER_DOCUMENT_TYPES.map((type) => row(type));
  rows[4] = row('MEDICAL_CHECK', 'VALID', {
    valid_until: '2026-09-03T11:59:59.999Z',
  });
  const result = project(rows);
  const medical = result.documents.find((d) => d.type === 'MEDICAL_CHECK');
  assert.equal(medical.status, 'EXPIRED');
  assert.equal(result.documentsReady, true);
  assert.equal(result.shiftReady, false);
  assert.equal(result.lineReady, false);
  assert.deepEqual(result.blockingReasons, ['MEDICAL_CHECK_EXPIRED']);
});

test('future valid_from never grants readiness', () => {
  const rows = DRIVER_DOCUMENT_TYPES.map((type) => row(type));
  rows[1] = row('TAXI_OSAGO', 'VALID', {
    valid_from: '2026-09-04T00:00:00.000Z',
  });
  const result = project(rows);
  assert.equal(result.lineReady, false);
  assert.deepEqual(result.blockingReasons, ['TAXI_OSAGO_NOT_YET_VALID']);
});

test('shift evidence without valid_until is rejected by the projection too', () => {
  const rows = DRIVER_DOCUMENT_TYPES.map((type) => row(type));
  rows[3] = row('WAYBILL', 'VALID', { valid_until: null });
  const result = project(rows);
  assert.equal(result.documentsReady, true);
  assert.equal(result.shiftReady, false);
  assert.equal(result.lineReady, false);
  assert.deepEqual(result.blockingReasons, ['WAYBILL_VALIDITY_MISSING']);
});

test('pending and rejected states are blockers in canonical order', () => {
  const rows = [
    row('DRIVER_LICENSE', 'UPLOADED'),
    row('TAXI_OSAGO', 'VERIFYING'),
    row('TAXI_REGISTRY', 'REJECTED', { verification_reason: 'blurred scan' }),
    row('WAYBILL'),
    row('MEDICAL_CHECK'),
  ];
  const result = project(rows);
  assert.equal(result.documentsReady, false);
  assert.equal(result.shiftReady, true);
  assert.equal(result.lineReady, false);
  assert.deepEqual(result.blockingReasons, [
    'DRIVER_LICENSE_UPLOADED',
    'TAXI_OSAGO_VERIFYING',
    'TAXI_REGISTRY_REJECTED',
  ]);
  assert.equal(
    result.documents.find((d) => d.type === 'TAXI_REGISTRY').verificationReason,
    'blurred scan',
  );
});

test('sensitive storage/verifier fields never enter the driver projection', () => {
  const result = project(DRIVER_DOCUMENT_TYPES.map((type) => row(type)));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('object_key'), false);
  assert.equal(serialized.includes('objectKey'), false);
  assert.equal(serialized.includes('verification_source'), false);
  assert.equal(serialized.includes('verificationSource'), false);
  assert.equal(serialized.includes('private/'), false);
  assert.equal(serialized.includes('test-verifier'), false);
});

test('unknown, duplicate and cross-driver rows fail closed', () => {
  assert.throws(
    () => project([row('ALIEN_DOCUMENT')]),
    /unknown driver document type/,
  );
  assert.throws(
    () => project([row('DRIVER_LICENSE', 'MISSING')]),
    /unknown driver document status/,
  );
  assert.throws(
    () => project([row('DRIVER_LICENSE'), row('DRIVER_LICENSE')]),
    /duplicate driver document type/,
  );
  assert.throws(
    () => project([row('DRIVER_LICENSE', 'VALID', {
      driver_id: '22222222-2222-4222-8222-222222222222',
    })]),
    /ownership mismatch/,
  );
});
