// /server/src/services/merchant-identity-contact-authority/index.js
// BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B dark service seam.
//
// This module composes canonical external identity + merchant binding + merchant lifecycle +
// merchant membership. It is deliberately NOT registered as a live HTTP service/route.
// Context resolution is not authorization. Economically/operationally binding actions must use
// resolveAuthorizedMerchantActor (or a future stronger operation-specific gate), never a binding
// lookup alone.
//
// 01B intentionally exposes READ/COMPOSITION only. Merchant/bootstrap/membership/contact identity
// mutations stay repository-level and are not wired into a business service until the later
// audit-provenance slice can durably record actor + trusted procedure for every authority write.
// These resolvers are therefore READ-SIDE CURRENT-STATE SNAPSHOTS, not reusable authorization
// tokens. A future state-changing service must re-resolve the actor under its own transaction/
// lock boundary immediately before mutation; carrying a successful read across a write boundary
// would be a TOCTOU bug and is explicitly outside 01B.

import { findMerchantById } from '../../repositories/merchants.js';
import { findActiveMerchantMembership } from '../../repositories/merchant_memberships.js';
import { findExternalContactIdentityByCanonical } from '../../repositories/external_contact_identities.js';
import { listActiveBindingsForExternalIdentity } from '../../repositories/merchant_contact_bindings.js';

const ACTIVE = 'ACTIVE';
const VERIFIED = 'VERIFIED';

export async function resolveMerchantContext(db, {
  channel,
  subjectNamespace,
  canonicalSubjectKey,
  merchantId = null,
}) {
  const externalIdentity = await findExternalContactIdentityByCanonical(db, {
    channel,
    subjectNamespace,
    canonicalSubjectKey,
  });

  if (!externalIdentity || externalIdentity.status !== ACTIVE) {
    return { ok: false, code: 'EXTERNAL_CONTACT_UNKNOWN' };
  }

  const bindings = await listActiveBindingsForExternalIdentity(db, externalIdentity.id);

  if (merchantId) {
    const exact = bindings.find((row) => row.merchant_id === merchantId);
    if (!exact) return { ok: false, code: 'EXTERNAL_CONTACT_UNKNOWN' };
    if (exact.merchant_status !== ACTIVE) return { ok: false, code: 'MERCHANT_INOPERABLE' };
    return {
      ok: true,
      externalIdentity: externalIdentityProjection(externalIdentity),
      binding: bindingProjection(exact),
      merchant: merchantProjection(exact),
    };
  }

  const operable = bindings.filter((row) => row.merchant_status === ACTIVE);
  if (operable.length === 0) {
    return { ok: false, code: bindings.length > 0 ? 'MERCHANT_INOPERABLE' : 'EXTERNAL_CONTACT_UNKNOWN' };
  }
  if (operable.length > 1) {
    return { ok: false, code: 'MERCHANT_CONTEXT_AMBIGUOUS' };
  }

  return {
    ok: true,
    externalIdentity: externalIdentityProjection(externalIdentity),
    binding: bindingProjection(operable[0]),
    merchant: merchantProjection(operable[0]),
  };
}

export async function resolveMerchantMembership(db, { merchantId, userId }) {
  const merchant = await findMerchantById(db, merchantId);
  if (!merchant) return { ok: false, code: 'MERCHANT_NOT_FOUND' };
  if (merchant.status !== ACTIVE) return { ok: false, code: 'MERCHANT_INOPERABLE' };

  const membership = await findActiveMerchantMembership(db, { merchantId, userId });
  if (!membership) return { ok: false, code: 'MERCHANT_MEMBERSHIP_REQUIRED' };

  return { ok: true, merchant, membership };
}

export async function resolveAuthorizedMerchantActor(db, {
  channel,
  subjectNamespace,
  canonicalSubjectKey,
  merchantId = null,
  allowedRoles = ['ADMIN', 'OPERATOR'],
}) {
  const context = await resolveMerchantContext(db, {
    channel,
    subjectNamespace,
    canonicalSubjectKey,
    merchantId,
  });
  if (!context.ok) return context;

  const identity = context.externalIdentity;
  if (identity.channel_proof !== VERIFIED) {
    return { ok: false, code: 'CONTACT_CHANNEL_PROOF_REQUIRED' };
  }
  if (!identity.linked_user_id) {
    return { ok: false, code: 'CONTACT_USER_LINK_REQUIRED' };
  }

  const membershipResult = await resolveMerchantMembership(db, {
    merchantId: context.merchant.id,
    userId: identity.linked_user_id,
  });
  if (!membershipResult.ok) return membershipResult;

  if (!allowedRoles.includes(membershipResult.membership.membership_role)) {
    return { ok: false, code: 'MERCHANT_ACTOR_UNAUTHORIZED' };
  }

  return {
    ok: true,
    code: 'AUTHORIZED_MERCHANT_ACTOR',
    userId: identity.linked_user_id,
    merchant: context.merchant,
    membership: membershipResult.membership,
    externalIdentity: identity,
    binding: context.binding,
  };
}


function externalIdentityProjection(row) {
  return {
    id: row.id,
    channel: row.channel,
    status: row.status,
    channel_proof: row.channel_proof,
    linked_user_id: row.linked_user_id,
    linked_at: row.linked_at,
  };
}

function merchantProjection(row) {
  return {
    id: row.merchant_id,
    display_name: row.merchant_display_name,
    status: row.merchant_status,
  };
}

function bindingProjection(row) {
  return {
    id: row.id,
    merchant_id: row.merchant_id,
    external_contact_identity_id: row.external_contact_identity_id,
    relationship: row.relationship,
    status: row.status,
    bound_at: row.bound_at,
  };
}
