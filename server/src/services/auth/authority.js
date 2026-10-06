// Dark current-account authority: no route wiring or session/account mutations.
// This is a read snapshot, not a reusable permit for a later protected mutation.
import { findUserAuthorityById } from '../../repositories/users.js';

const deny = (reason, retryable = false) => ({ ok: false, reason, retryable });
const supportedRole = (role) => role === 'passenger' || role === 'driver';
const validGrants = (roles) => Array.isArray(roles)
  && Array.from(roles).every(supportedRole);
const validIdentity = (actor) => typeof actor?.userId === 'string'
  && actor.userId.trim().length > 0
  && typeof actor.sessionId === 'string' && actor.sessionId.trim().length > 0;

function roleAuthorityFailure(actor) {
  if (!validGrants(actor.roles)) return deny('INVALID_ROLE_GRANTS');
  if (actor.activeRole == null) return deny('ACTIVE_ROLE_MISSING');
  if (!supportedRole(actor.activeRole)) return deny('INVALID_ACTIVE_ROLE');
  if (!actor.roles.includes(actor.activeRole)) return deny('ACTIVE_ROLE_NOT_GRANTED');
  if (actor.phoneVerified !== true) return deny('PHONE_NOT_VERIFIED');
  return null;
}

// sessionActor must already come from live session resolution (req.resolveUser).
export async function resolveActorAuthority(db, sessionActor) {
  if (sessionActor == null) return deny('UNAUTHENTICATED');
  if (!validIdentity(sessionActor)) return deny('INVALID_SESSION_ACTOR');
  const { userId, sessionId, activeRole, phoneVerified } = sessionActor;
  let account;
  try {
    account = await findUserAuthorityById(db, userId);
  } catch {
    return deny('AUTHORITY_LOOKUP_FAILED', true);
  }
  if (!account) return deny('ACCOUNT_NOT_FOUND');

  const actor = {
    userId,
    sessionId,
    phoneVerified: phoneVerified === true && account.phone_verified === true,
    activeRole,
    roles: account.roles,
  };
  const failure = roleAuthorityFailure(actor);
  if (failure) return failure;
  return { ok: true, actor: { ...actor, roles: [...actor.roles] } };
}

// Guards consume the resolver result, preserving retryable failures without I/O.
function requireRoleActor(authority, role) {
  if (authority == null) return deny('UNAUTHENTICATED');
  if (authority.ok === false) return authority;
  if (authority.ok !== true || !validIdentity(authority.actor)) {
    return deny('INVALID_ACTOR_AUTHORITY');
  }
  const failure = roleAuthorityFailure(authority.actor);
  if (failure) return failure;
  if (authority.actor.activeRole !== role) return deny('WRONG_ACTIVE_ROLE');
  return { ok: true, actor: authority.actor };
}

export function requirePassengerActor(authority) {
  return requireRoleActor(authority, 'passenger');
}

export function requireDriverActor(authority) {
  return requireRoleActor(authority, 'driver');
}
