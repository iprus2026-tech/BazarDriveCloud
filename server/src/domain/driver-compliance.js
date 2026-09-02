// /server/src/domain/driver-compliance.js
// BD-DRIVER-DOCUMENT-COMPLIANCE-01B (#955)
//
// Pure, deterministic projection from server-owned driver_documents rows to the
// self-scoped Driver App compliance verdict. No storage, HTTP, or client state.

export const DRIVER_DOCUMENT_TYPES = Object.freeze([
  'DRIVER_LICENSE',
  'TAXI_OSAGO',
  'TAXI_REGISTRY',
  'WAYBILL',
  'MEDICAL_CHECK',
]);

export const DRIVER_DOCUMENT_STATUSES = Object.freeze([
  'MISSING',
  'UPLOADED',
  'VERIFYING',
  'VALID',
  'EXPIRING',
  'REJECTED',
  'EXPIRED',
]);

const LONG_LIVED_TYPES = new Set([
  'DRIVER_LICENSE',
  'TAXI_OSAGO',
  'TAXI_REGISTRY',
]);
const SHIFT_TYPES = new Set(['WAYBILL', 'MEDICAL_CHECK']);
const STORED_STATUSES = new Set(DRIVER_DOCUMENT_STATUSES.filter((s) => s !== 'MISSING'));
const READY_STATUSES = new Set(['VALID', 'EXPIRING']);

function requiredDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid ${field}`);
  return date;
}

function optionalDate(value, field) {
  if (value === null || value === undefined) return null;
  return requiredDate(value, field);
}

function nullableString(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`invalid ${field}`);
  return value;
}

function missingDocument(type) {
  return {
    id: null,
    type,
    scope: LONG_LIVED_TYPES.has(type) ? 'LONG_LIVED' : 'SHIFT',
    status: 'MISSING',
    validFrom: null,
    validUntil: null,
    issuedAt: null,
    verifiedAt: null,
    verificationReason: null,
    updatedAt: null,
  };
}

function projectStoredDocument(row, type, evaluatedAt) {
  const storedStatus = row.status;
  if (!STORED_STATUSES.has(storedStatus)) {
    throw new Error(`unknown driver document status: ${String(storedStatus)}`);
  }

  const validFrom = optionalDate(row.valid_from, `${type}.valid_from`);
  const validUntil = optionalDate(row.valid_until, `${type}.valid_until`);
  const issuedAt = optionalDate(row.issued_at, `${type}.issued_at`);
  const verifiedAt = optionalDate(row.verified_at, `${type}.verified_at`);
  const updatedAt = optionalDate(row.updated_at, `${type}.updated_at`);

  let effectiveStatus = storedStatus;
  let ready = READY_STATUSES.has(storedStatus);
  let blocker = null;
  let warning = null;

  if (ready && validFrom && validFrom.getTime() > evaluatedAt.getTime()) {
    ready = false;
    blocker = `${type}_NOT_YET_VALID`;
  } else if (ready && validUntil && validUntil.getTime() <= evaluatedAt.getTime()) {
    // Do not wait for the future expiry worker. A stale stored VALID/EXPIRING row
    // with elapsed validity is projected as EXPIRED immediately.
    effectiveStatus = 'EXPIRED';
    ready = false;
    blocker = `${type}_EXPIRED`;
  } else if (ready && SHIFT_TYPES.has(type) && !validUntil) {
    // Duplicates the DB invariant deliberately: privileged imports or temporary
    // constraint bypasses must still never grant a shift-ready verdict.
    ready = false;
    blocker = `${type}_VALIDITY_MISSING`;
  } else if (!ready) {
    blocker = `${type}_${storedStatus}`;
  } else if (effectiveStatus === 'EXPIRING') {
    warning = `${type}_EXPIRING_SOON`;
  }

  return {
    document: {
      id: row.id === null || row.id === undefined ? null : String(row.id),
      type,
      scope: LONG_LIVED_TYPES.has(type) ? 'LONG_LIVED' : 'SHIFT',
      status: effectiveStatus,
      validFrom: validFrom?.toISOString() ?? null,
      validUntil: validUntil?.toISOString() ?? null,
      issuedAt: issuedAt?.toISOString() ?? null,
      verifiedAt: verifiedAt?.toISOString() ?? null,
      verificationReason: nullableString(row.verification_reason, `${type}.verification_reason`),
      updatedAt: updatedAt?.toISOString() ?? null,
    },
    ready,
    blocker,
    warning,
  };
}

export function buildDriverComplianceProjection(
  rows,
  { driverId, evaluatedAt = new Date() } = {},
) {
  if (!Array.isArray(rows)) throw new TypeError('driver document rows must be an array');
  if (typeof driverId !== 'string' || !driverId) throw new TypeError('driverId is required');

  const evaluated = requiredDate(evaluatedAt, 'evaluatedAt');
  const byType = new Map();

  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new Error('invalid driver document row');
    const type = row.document_type;
    if (!DRIVER_DOCUMENT_TYPES.includes(type)) {
      throw new Error(`unknown driver document type: ${String(type)}`);
    }
    if (row.driver_id !== null && row.driver_id !== undefined
        && String(row.driver_id) !== driverId) {
      throw new Error(`driver document ownership mismatch: ${type}`);
    }
    if (byType.has(type)) throw new Error(`duplicate driver document type: ${type}`);
    byType.set(type, row);
  }

  const evaluatedDocuments = DRIVER_DOCUMENT_TYPES.map((type) => {
    const row = byType.get(type);
    if (!row) {
      return {
        document: missingDocument(type),
        ready: false,
        blocker: `${type}_MISSING`,
        warning: null,
      };
    }
    return projectStoredDocument(row, type, evaluated);
  });

  const documentsReady = evaluatedDocuments
    .filter(({ document }) => document.scope === 'LONG_LIVED')
    .every(({ ready }) => ready);
  const shiftReady = evaluatedDocuments
    .filter(({ document }) => document.scope === 'SHIFT')
    .every(({ ready }) => ready);

  return {
    driverId,
    documents: evaluatedDocuments.map(({ document }) => document),
    documentsReady,
    shiftReady,
    lineReady: documentsReady && shiftReady,
    blockingReasons: evaluatedDocuments.map(({ blocker }) => blocker).filter(Boolean),
    warnings: evaluatedDocuments.map(({ warning }) => warning).filter(Boolean),
    evaluatedAt: evaluated.toISOString(),
  };
}
