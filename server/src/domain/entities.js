// /server/src/domain/entities.js — JSDoc typedefs for the BD-DOCS-031 entities: the
// shared vocabulary repositories/services type against without a build step (// @ts-check
// friendly). Field shapes mirror the migrations (0001/0002) verbatim. This is
// documentation-as-types; it ships no runtime code. Entities fill in as their module PRs
// land (ADR BD-DOCS-041 migration path).

/**
 * users — 0001 stub refined by 0002 (BD-DOCS-032 identity).
 * @typedef {Object} UserIdentity
 * @property {string} id
 * @property {string|null} phone
 * @property {boolean} phoneVerified            // server fact (set on OTP verify)
 * @property {string[]} roles                   // granted set: subset of ['passenger','driver']
 * @property {('passenger'|'driver'|'guest'|null)} activeRole
 */

/**
 * auth_session — 0002. user.v1 is a client cache of this row.
 * @typedef {Object} AuthSession
 * @property {string} id
 * @property {string} userId
 * @property {('passenger'|'driver'|null)} activeRole
 * @property {boolean} phoneVerified
 * @property {string|null} expiresAt            // ISO; null = no modeled expiry yet
 * @property {string|null} revokedAt            // ISO; non-null => dead
 */

/**
 * auth_otp — 0002. Phone-verification one-time codes (hash only).
 * @typedef {Object} AuthOtp
 * @property {string} id
 * @property {string} phone
 * @property {string} expiresAt                 // ISO
 * @property {string|null} consumedAt           // ISO; non-null => already used
 * @property {number} attempts
 */

export {}; // types-only module — no runtime exports
