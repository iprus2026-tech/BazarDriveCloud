// /server/src/repositories/driver_document_compliance.js — the ONLY module that runs SQL
// against `driver_document_lineages` and `driver_documents` (migration 0007). Single SQL
// seam (ADR BD-DOCS-041). BD-DRIVER-DOCUMENT-COMPLIANCE-01B (rebuild), per the frozen
// docs/driver-document-compliance-contract.md, built against the now-real
// docs/driver-shift-authority-contract.md.
//
// Low-level primitives only — NOT public authorization operations, and NOT the full
// verification-lifecycle/activation-transaction logic (that is explicitly a LATER slice,
// 01C-or-later, per this slice's own scope). Every function takes a plain `db` (or a
// transaction client with the same `.query` shape), returns raw rows or null, and performs
// no orchestration (subject-shape decisions, lock order composition, "is this shift still
// OPEN" authorization) — that composition belongs to a future service seam, mirroring the
// vehicle_driver_assignments.js / driver_shifts.js split exactly.
//
// Never trusts client timestamps or client subject identity: created_at/updated_at are
// always DB-stamped (now()/DEFAULT), and every subject id here (driver_id/vehicle_id/
// shift_id) is whatever the caller passes in — a future authorized-write service is
// responsible for deriving/validating those from server-owned state (the authenticated
// driver session, the OPEN driver_shift's own pinned vehicle_id), never from client input
// directly. The DB's own subject-shape CHECK and composite FKs (migration 0007) are the
// final backstop against an internally inconsistent subject tuple, independent of whatever
// this module is called with.

// -----------------------------------------------------------------------------------------
// driver_document_lineages — immutable subject identity per lineage.
// -----------------------------------------------------------------------------------------

// Create a new lineage. documentType decides which of driverId/vehicleId/shiftId the DB's
// own subject-shape CHECK (driver_document_lineages_subject_shape_check) requires to be
// non-null vs. null — this primitive does not re-validate that shape in JS; a violating
// INSERT throws a pg error (23514 check_violation) and the caller decides how to surface it.
// A concurrent first-insert race for the SAME subject tuple is resolved by the type-specific
// partial unique index (23505 unique_violation) — the losing caller attaches to the winner's
// row via findLineageBySubject, never starts a second lineage.
export async function insertLineage(db, {
  documentType, driverId = null, vehicleId = null, shiftId = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO driver_document_lineages (document_type, driver_id, vehicle_id, shift_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [documentType, driverId, vehicleId, shiftId],
  );
  return rows[0];
}

// Plain read by exact subject tuple — no lock. IS NOT DISTINCT FROM (null-safe) since a
// given document_type only ever populates the subset of columns its subject scope requires
// (docs/driver-document-compliance-contract.md "Subject-scoped ownership"); a plain `=`
// would never match a NULL column even when both sides are correctly absent.
export async function findLineageBySubject(db, {
  documentType, driverId = null, vehicleId = null, shiftId = null,
}) {
  const { rows } = await db.query(
    `SELECT * FROM driver_document_lineages
      WHERE document_type = $1
        AND driver_id  IS NOT DISTINCT FROM $2
        AND vehicle_id IS NOT DISTINCT FROM $3
        AND shift_id   IS NOT DISTINCT FROM $4
      LIMIT 1`,
    [documentType, driverId, vehicleId, shiftId],
  );
  return rows[0] ?? null;
}

// Lock the lineage row by exact subject tuple (SELECT ... FOR UPDATE) inside a transaction —
// for a future authorized-write service about to insert a new submission attempt into this
// lineage (e.g. re-checking "no open submission" under lock before the INSERT).
export async function lockLineageBySubject(db, {
  documentType, driverId = null, vehicleId = null, shiftId = null,
}) {
  const { rows } = await db.query(
    `SELECT * FROM driver_document_lineages
      WHERE document_type = $1
        AND driver_id  IS NOT DISTINCT FROM $2
        AND vehicle_id IS NOT DISTINCT FROM $3
        AND shift_id   IS NOT DISTINCT FROM $4
      FOR UPDATE
      LIMIT 1`,
    [documentType, driverId, vehicleId, shiftId],
  );
  return rows[0] ?? null;
}

// Plain read by id — no lock.
export async function findLineageById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM driver_document_lineages WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Lock the lineage row by id (SELECT ... FOR UPDATE) inside a transaction.
export async function lockLineageById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM driver_document_lineages WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

// List every lineage naming this exact driver as a subject (DRIVER_LICENSE, WAYBILL,
// MEDICAL_CHECK) — a future compliance projection's own read path, not used by this slice.
export async function listLineagesForDriver(db, driverId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_document_lineages WHERE driver_id = $1 ORDER BY created_at ASC`,
    [driverId],
  );
  return rows;
}

// List every lineage naming this exact vehicle as a subject (TAXI_OSAGO, TAXI_REGISTRY,
// WAYBILL).
export async function listLineagesForVehicle(db, vehicleId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_document_lineages WHERE vehicle_id = $1 ORDER BY created_at ASC`,
    [vehicleId],
  );
  return rows;
}

// List every lineage naming this exact shift as a subject (WAYBILL, MEDICAL_CHECK) — the
// exact read a future per-shift compliance evaluation needs.
export async function listLineagesForShift(db, shiftId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_document_lineages WHERE shift_id = $1 ORDER BY created_at ASC`,
    [shiftId],
  );
  return rows;
}

// -----------------------------------------------------------------------------------------
// driver_documents — one row per submission ATTEMPT, versioned, never mutated into
// history-loss.
// -----------------------------------------------------------------------------------------

// Insert a new submission attempt into an existing lineage. Defaults to status = 'UPLOADED'
// (the DB column default), matching "MISSING -> UPLOADED creates a lineage's first row" —
// callers exercising other stored statuses directly (adversarial/fixture setup) may pass an
// explicit status. Does NOT re-run the "at most one open submission per lineage" check in
// JS: driver_documents_one_open_per_lineage_uq (partial unique index, migration 0007) is the
// DB's own final backstop; a violating INSERT throws 23505 and the caller translates it.
export async function insertSubmission(db, {
  lineageId, status = 'UPLOADED', supersedesId = null, objectKey = null,
  issuedAt = null, validFrom = null, validUntil = null,
  verifiedAt = null, verificationSource = null, verificationReason = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO driver_documents
       (lineage_id, status, supersedes_id, object_key, issued_at, valid_from, valid_until,
        verified_at, verification_source, verification_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      lineageId, status, supersedesId, objectKey, issuedAt, validFrom, validUntil,
      verifiedAt, verificationSource, verificationReason,
    ],
  );
  return rows[0];
}

// Plain read: the lineage's current open submission (status IN UPLOADED/VERIFYING/APPROVED),
// or null. No lock — a fast existence check inside an already-locked transaction (the
// caller's own lineage lock, above, already serializes this read for a concurrent attempt on
// the SAME lineage).
export async function findOpenSubmissionForLineage(db, lineageId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_documents
      WHERE lineage_id = $1 AND status IN ('UPLOADED', 'VERIFYING', 'APPROVED')
      LIMIT 1`,
    [lineageId],
  );
  return rows[0] ?? null;
}

// Lock the lineage's open submission row (SELECT ... FOR UPDATE) inside a transaction — for a
// future verification/activation transaction about to transition it.
export async function lockOpenSubmissionForLineage(db, lineageId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_documents
      WHERE lineage_id = $1 AND status IN ('UPLOADED', 'VERIFYING', 'APPROVED')
      FOR UPDATE
      LIMIT 1`,
    [lineageId],
  );
  return rows[0] ?? null;
}

// The lineage's latest submission — the newest row, ordered by (created_at, id) for a
// deterministic tie-break (docs/driver-document-compliance-contract.md "the newest row in
// the lineage, ordered by (created_at, id)") — regardless of status, or null if the lineage
// has no rows at all.
export async function findLatestSubmissionForLineage(db, lineageId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_documents
      WHERE lineage_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [lineageId],
  );
  return rows[0] ?? null;
}

// Full submission history for a lineage, oldest first — every attempt (successful, rejected,
// and pending alike), never filtered by status.
export async function listSubmissionsForLineage(db, lineageId) {
  const { rows } = await db.query(
    `SELECT * FROM driver_documents WHERE lineage_id = $1 ORDER BY created_at ASC, id ASC`,
    [lineageId],
  );
  return rows;
}

// Plain read by id — no lock.
export async function findSubmissionById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM driver_documents WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// Lock a submission row by id (SELECT ... FOR UPDATE) inside a transaction.
export async function lockSubmissionById(db, id) {
  const { rows } = await db.query(
    `SELECT * FROM driver_documents WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}
