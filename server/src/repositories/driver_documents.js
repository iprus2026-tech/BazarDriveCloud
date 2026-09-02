// /server/src/repositories/driver_documents.js
// The sole SQL seam for driver_documents (BD-DRIVER-DOCUMENT-COMPLIANCE-01B).
// 01B is read-only at HTTP level; future upload/verifier writes must land here in
// their own slices rather than placing SQL in routes or client-facing modules.

export async function listDriverDocumentsForDriver(db, driverId) {
  const { rows } = await db.query(
    `SELECT id, driver_id, document_type, status,
            valid_from, valid_until, issued_at, verified_at,
            verification_reason, created_at, updated_at
       FROM driver_documents
      WHERE driver_id = $1
      ORDER BY CASE document_type
        WHEN 'DRIVER_LICENSE' THEN 1
        WHEN 'TAXI_OSAGO' THEN 2
        WHEN 'TAXI_REGISTRY' THEN 3
        WHEN 'WAYBILL' THEN 4
        WHEN 'MEDICAL_CHECK' THEN 5
        ELSE 99
      END`,
    [driverId],
  );
  return rows;
}
