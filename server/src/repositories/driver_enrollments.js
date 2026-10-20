// /server/src/repositories/driver_enrollments.js — the ONLY module that runs SQL against
// driver_enrollments (migration 0010, BD-AUTH-POLICY-01B-A). Repositories are the single SQL
// seam (ADR BD-DOCS-041). Lifecycle rules live in services/driver-enrollment/decisions.js;
// this module only reads and writes rows.

const COLUMNS = `id, user_id, status, requested_at, decided_at, decided_by, decision_reason`;

// The account's open application (PENDING or APPROVED; at most one by the partial unique
// index), row-locked for a decision in the same transaction.
export async function lockOpenEnrollment(db, userId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
       FROM driver_enrollments
      WHERE user_id = $1 AND status IN ('PENDING', 'APPROVED')
      LIMIT 1
      FOR UPDATE`,
    [userId],
  );
  return rows[0] ?? null;
}

// The account's latest application of any status (the applicant's GET).
export async function findLatestEnrollment(db, userId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS}
       FROM driver_enrollments
      WHERE user_id = $1
      ORDER BY requested_at DESC, created_at DESC
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

// A new application. status PENDING leaves the decision columns NULL; a decided row
// (auto-approve, or a REVOKED record for a grant made before 01B-A) stamps them now.
export async function insertEnrollment(db, { userId, status = 'PENDING', decidedBy = null, reason = null }) {
  const decided = status !== 'PENDING';
  const { rows } = await db.query(
    `INSERT INTO driver_enrollments (user_id, status, decided_at, decided_by, decision_reason)
       VALUES ($1, $2, CASE WHEN $3::boolean THEN now() END, $4, $5)
     RETURNING ${COLUMNS}`,
    [userId, status, decided, decided ? decidedBy : null, decided ? reason : null],
  );
  return rows[0];
}

// Record a decision on an existing row (PENDING -> APPROVED/REJECTED, APPROVED -> REVOKED).
export async function decideEnrollment(db, id, { status, decidedBy, reason = null }) {
  const { rows } = await db.query(
    `UPDATE driver_enrollments
        SET status = $2, decided_at = now(), decided_by = $3, decision_reason = $4
      WHERE id = $1
     RETURNING ${COLUMNS}`,
    [id, status, decidedBy, reason],
  );
  return rows[0] ?? null;
}

// How many applications are pending (the operator list states it even when the display is capped).
export async function countPendingEnrollments(db) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM driver_enrollments WHERE status = 'PENDING'`);
  return rows[0].n;
}

// The operator's queue: pending applications, oldest first, with the applicant's phone for
// display (the caller masks it).
export async function listPendingEnrollments(db, { limit = 50 } = {}) {
  const { rows } = await db.query(
    `SELECT e.id, e.user_id, e.requested_at, u.phone
       FROM driver_enrollments e
       JOIN users u ON u.id = e.user_id
      WHERE e.status = 'PENDING'
      ORDER BY e.requested_at
      LIMIT $1`,
    [limit],
  );
  return rows;
}
