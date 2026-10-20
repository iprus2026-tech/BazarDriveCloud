// /server/src/services/driver-enrollment/decisions.js — driver enrollment lifecycle
// (BD-AUTH-POLICY-01B-A; docs/driver-role-grant-contract.md §1).
//
// Transport-agnostic on purpose: no Fastify, no console, no process exit. The HTTP routes
// (./index.js) and the operator command (scripts/ops-driver.mjs) are thin adapters, and a
// later Telegram bot or admin route reuses the same functions with its own `decidedBy` label.
//
// Every function takes `db` with `db.tx(fn)` (the fastify.db facade, or the CLI's equivalent)
// and returns a structured result `{ ok, code, ... }`; only unexpected database errors throw.
// An application row and users.roles always change in ONE transaction, after the account row
// is locked (FOR UPDATE), so concurrent applications/decisions serialize.
import {
  lockUserForGrant, addRoleGrant, removeRoleGrant, findUserByPhone, findUserAuthorityById,
} from '../../repositories/users.js';
import { resetLiveSessionsActiveRole } from '../../repositories/sessions.js';
import {
  lockOpenEnrollment, findLatestEnrollment, insertEnrollment, decideEnrollment,
} from '../../repositories/driver_enrollments.js';
import { normalizePhone, isValidPhone } from '../auth/phone.js';

export const DRIVER_ROLE = 'driver';
export const AUTO_APPROVE_ACTOR = 'auto-approve';
export const DECISIONS = Object.freeze(['approve', 'reject', 'revoke']);

const MAX_DECIDED_BY = 200;
const MAX_REASON = 500;

const rolesOf = (user) => Array.from(user?.roles ?? []);
const hasDriverGrant = (user) => rolesOf(user).includes(DRIVER_ROLE);
const fail = (code, extra = {}) => ({ ok: false, code, ...extra });

// The applicant's view of one application: status and timestamps only — never the decision
// actor or reason.
export function serializeEnrollment(row) {
  if (!row) return null;
  return {
    status: row.status,
    requestedAt: row.requested_at instanceof Date ? row.requested_at.toISOString() : row.requested_at,
    decidedAt: row.decided_at instanceof Date ? row.decided_at.toISOString() : (row.decided_at ?? null),
  };
}

// POST /drivers/enrollment semantics. The caller (route) has already authenticated the
// session; this re-reads the account under a row lock.
//   ALREADY_GRANTED  — the account holds the driver grant (no new row)
//   ALREADY_PENDING  — an open PENDING application exists (idempotent)
//   CREATED          — a new PENDING application
//   AUTO_APPROVED    — a new application approved in the same transaction (stand only)
// Failures: ACCOUNT_NOT_FOUND, PHONE_NOT_VERIFIED, ENROLLMENT_STATE_CONFLICT (an APPROVED row
// without the grant — the grant was changed outside the decision path; nothing is written).
export async function submitDriverEnrollment(db, { userId, autoApprove = false }) {
  return db.tx(async (client) => {
    const user = await lockUserForGrant(client, userId);
    if (!user) return fail('ACCOUNT_NOT_FOUND');
    if (user.phone_verified !== true) return fail('PHONE_NOT_VERIFIED');
    if (hasDriverGrant(user)) {
      return {
        ok: true, code: 'ALREADY_GRANTED', created: false,
        enrollment: await findLatestEnrollment(client, userId), roles: rolesOf(user),
      };
    }
    const open = await lockOpenEnrollment(client, userId);
    if (open?.status === 'PENDING') {
      return { ok: true, code: 'ALREADY_PENDING', created: false, enrollment: open, roles: rolesOf(user) };
    }
    if (open) return fail('ENROLLMENT_STATE_CONFLICT', { enrollment: open, roles: rolesOf(user) });

    if (!autoApprove) {
      const enrollment = await insertEnrollment(client, { userId });
      return { ok: true, code: 'CREATED', created: true, enrollment, roles: rolesOf(user) };
    }
    const enrollment = await insertEnrollment(client, {
      userId, status: 'APPROVED', decidedBy: AUTO_APPROVE_ACTOR,
    });
    const granted = await addRoleGrant(client, userId, DRIVER_ROLE);
    return { ok: true, code: 'AUTO_APPROVED', created: true, enrollment, roles: rolesOf(granted) };
  });
}

// GET /drivers/enrollment: the latest application (any status) and the current grants.
export async function readDriverEnrollment(db, { userId }) {
  const [enrollment, user] = await Promise.all([
    findLatestEnrollment(db, userId),
    findUserAuthorityById(db, userId),
  ]);
  if (!user) return fail('ACCOUNT_NOT_FOUND');
  return { ok: true, code: 'OK', enrollment, roles: rolesOf(user) };
}

async function resolveTargetUserId(db, target) {
  if (target && typeof target.userId === 'string' && target.userId.trim()) return target.userId.trim();
  if (target && typeof target.phone === 'string') {
    const phone = normalizePhone(target.phone);
    if (!isValidPhone(phone)) return null;
    const user = await findUserByPhone(db, phone);
    return user?.id ?? null;
  }
  return null;
}

function validateDecisionInput({ decision, decidedBy, reason }) {
  if (!DECISIONS.includes(decision)) return 'INVALID_DECISION';
  if (typeof decidedBy !== 'string' || !decidedBy.trim() || decidedBy.trim().length > MAX_DECIDED_BY) {
    return 'INVALID_DECIDED_BY';
  }
  if (reason != null && (typeof reason !== 'string' || reason.length > MAX_REASON)) return 'INVALID_REASON';
  return null;
}

// An operator (or a later adapter) decides on an account's driver enrollment.
//   target    { userId } | { phone }
//   decision  'approve' | 'reject' | 'revoke'
//   decidedBy non-PII actor label, e.g. 'ops-cli:alice'
//   reason    optional, ≤ 500 chars
// Success codes: APPROVED, REJECTED, REVOKED; idempotent repeats ALREADY_APPROVED,
// ALREADY_REJECTED, ALREADY_REVOKED. Refusals (nothing written): INVALID_* input,
// ACCOUNT_NOT_FOUND, PHONE_NOT_VERIFIED, NO_PENDING_APPLICATION, NOT_APPROVED.
export async function decideDriverEnrollment(db, { target, decision, decidedBy, reason = null } = {}) {
  const invalid = validateDecisionInput({ decision, decidedBy, reason });
  if (invalid) return fail(invalid);
  const actor = decidedBy.trim();
  const note = reason == null || reason === '' ? null : reason;
  const userId = await resolveTargetUserId(db, target);
  if (!userId) return fail('ACCOUNT_NOT_FOUND');

  return db.tx(async (client) => {
    const user = await lockUserForGrant(client, userId);
    if (!user) return fail('ACCOUNT_NOT_FOUND');
    const open = await lockOpenEnrollment(client, userId);
    const result = (code, enrollment, roles = rolesOf(user)) => ({ ok: true, code, userId, enrollment, roles });

    if (decision === 'approve') {
      if (open?.status === 'APPROVED') return result('ALREADY_APPROVED', open);
      if (open?.status !== 'PENDING') return fail('NO_PENDING_APPLICATION', { userId });
      if (user.phone_verified !== true) return fail('PHONE_NOT_VERIFIED', { userId });
      const enrollment = await decideEnrollment(client, open.id, { status: 'APPROVED', decidedBy: actor, reason: note });
      const granted = await addRoleGrant(client, userId, DRIVER_ROLE);
      return result('APPROVED', enrollment, rolesOf(granted));
    }

    if (decision === 'reject') {
      if (open?.status === 'PENDING') {
        const enrollment = await decideEnrollment(client, open.id, { status: 'REJECTED', decidedBy: actor, reason: note });
        return result('REJECTED', enrollment);
      }
      const latest = open ?? await findLatestEnrollment(client, userId);
      if (latest?.status === 'REJECTED') return result('ALREADY_REJECTED', latest);
      return fail('NO_PENDING_APPLICATION', { userId });
    }

    // revoke: an APPROVED application, or a grant made before 01B-A (no row) -> REVOKED.
    if (open?.status !== 'APPROVED' && !hasDriverGrant(user)) {
      const latest = open ?? await findLatestEnrollment(client, userId);
      if (latest?.status === 'REVOKED') return result('ALREADY_REVOKED', latest);
      return fail('NOT_APPROVED', { userId });
    }
    const enrollment = open?.status === 'APPROVED'
      ? await decideEnrollment(client, open.id, { status: 'REVOKED', decidedBy: actor, reason: note })
      : await insertEnrollment(client, { userId, status: 'REVOKED', decidedBy: actor, reason: note });
    const remaining = rolesOf(user).filter((role) => role !== DRIVER_ROLE);
    const fallback = remaining.includes('passenger') ? 'passenger' : null;
    const updated = await removeRoleGrant(client, userId, DRIVER_ROLE, fallback);
    await resetLiveSessionsActiveRole(client, userId, DRIVER_ROLE, fallback);
    return result('REVOKED', enrollment, rolesOf(updated));
  });
}
