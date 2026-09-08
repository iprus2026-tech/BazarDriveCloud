// /server/src/repositories/external_contact_identities.js — canonical external-channel identity
// SQL seam. The canonical tuple is immutable; phone/display name are metadata, not alternate keys.
// 01B does not wire verify/link/revoke into a business service: live authority mutations wait for
// the later audit-provenance slice that durably records actor + trusted procedure.

export async function findExternalContactIdentityByCanonical(db, {
  channel,
  subjectNamespace,
  canonicalSubjectKey,
}) {
  const { rows } = await db.query(
    `SELECT * FROM external_contact_identities
      WHERE channel = $1 AND subject_namespace = $2 AND canonical_subject_key = $3
      LIMIT 1`,
    [channel, subjectNamespace, canonicalSubjectKey],
  );
  return rows[0] ?? null;
}

export async function lockExternalContactIdentityById(db, identityId) {
  const { rows } = await db.query(
    `SELECT * FROM external_contact_identities WHERE id = $1 FOR UPDATE`,
    [identityId],
  );
  return rows[0] ?? null;
}

export async function createExternalContactIdentity(db, {
  channel,
  subjectNamespace,
  canonicalSubjectKey,
  phoneE164 = null,
  displayName = null,
}) {
  const { rows } = await db.query(
    `INSERT INTO external_contact_identities
       (channel, subject_namespace, canonical_subject_key, phone_e164, display_name,
        status, channel_proof, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'OBSERVED', now(), now())
     RETURNING *`,
    [channel, subjectNamespace, canonicalSubjectKey, phoneE164, displayName],
  );
  return rows[0];
}

export async function verifyExternalContactIdentity(db, identityId) {
  const { rows } = await db.query(
    `UPDATE external_contact_identities
        SET channel_proof = 'VERIFIED'
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [identityId],
  );
  return rows[0] ?? null;
}

// This primitive does not prove user control. Only an identity-verification service may call it.
// The WHERE clause permits only the first link; the DB trigger is the final overwrite backstop.
export async function linkExternalContactToUser(db, { identityId, userId }) {
  const { rows } = await db.query(
    `UPDATE external_contact_identities
        SET linked_user_id = $2, linked_at = now()
      WHERE id = $1 AND status = 'ACTIVE' AND linked_user_id IS NULL
      RETURNING *`,
    [identityId, userId],
  );
  return rows[0] ?? null;
}

export async function revokeExternalContactIdentity(db, identityId) {
  const { rows } = await db.query(
    `UPDATE external_contact_identities
        SET status = 'REVOKED', revoked_at = now()
      WHERE id = $1 AND status = 'ACTIVE'
      RETURNING *`,
    [identityId],
  );
  return rows[0] ?? null;
}
