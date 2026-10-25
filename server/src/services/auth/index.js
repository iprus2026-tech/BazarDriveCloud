// /server/src/services/auth/index.js — BD-DOCS-032 phone+OTP + session service (ADR
// BD-DOCS-041 §API). All five routes are LIVE (OTP R02; logout #829 B1; active role
// BD-AUTH-POLICY-01B-B):
//   GET  /api/v1/auth/session             -> { user } (null when anonymous; user.roles = current grants)
//   POST /api/v1/auth/otp/request         -> { ok, expiresInSeconds, devCode? }
//   POST /api/v1/auth/otp/verify          -> { token, user }
//   POST /api/v1/auth/logout              -> { ok: true }
//   PUT  /api/v1/auth/session/active-role -> { user }   switch THIS session to a granted role
//
// Same-account session replacement (docs/driver-role-grant-contract.md §2, CWE-613): verify
// revokes a presented live bearer of the SAME account in the transaction that mints the new
// session; a failure there fails the verify (503) — a successful verify never leaves the
// replaced session live. Another account's bearer is untouched (B2-C account switch, #829).
//
// request mints a numeric code, stores ONLY its hash (auth_otp), and — in dev-mode — echoes
// the plaintext in the response (there is no SMS provider yet; BD-DOCS-032 open question).
// verify resolves the freshest live code for the phone, enforces the attempt cap, compares
// the code in constant time, then (only on success) atomically consumes it, resolves a
// DISTINCT identity per phone (replacing the old identical pseudo-ids), stamps the phone
// verified, and mints an opaque bearer session — storing only the token HASH and returning
// the plaintext exactly once. Each attempt is COUNTED atomically (a single UPDATE) before the
// compare, so the cap bounds guesses even under a concurrent burst. A wrong code and an absent
// code return the SAME generic 401 body (no account-existence oracle); the only residual signal
// is transient pending-OTP presence (the lock-out 429 / the extra count write), which is
// self-inducible via the open /otp/request and closes with the request-side rate-limiting noted
// below (deferred to pre-go-live, BD-DOCS-032).
import { generateToken, generateOtpCode, hashOtpCode, hashToken, hashesEqual } from './tokens.js';
import { normalizePhone, isValidPhone } from './phone.js';
import { insertOtp, findLatestLiveOtpByPhone, markOtpConsumed, incrementOtpAttempts } from '../../repositories/otps.js';
import {
  resolveVerifiedLoginUser, findUserAuthorityById, lockUserForGrant, setUserActiveRole,
} from '../../repositories/users.js';
import {
  insertSession, revokeSessionById, resolveLiveSessionByTokenHash, setSessionActiveRole,
  lockLiveSessionById,
} from '../../repositories/sessions.js';
import { bearerToken } from '../../plugins/auth.js';

const SWITCHABLE_ROLES = ['passenger', 'driver'];

// Thrown inside the verify transaction when the presented same-account session cannot be
// looked up or revoked: the whole login rolls back (no session minted, no OTP consumed).
class SessionReplacementError extends Error {}

// Uniform problem shape { error, code, retryable } — matches plugins/error-handler.js so the
// client loadResource overlay reads these the same as a thrown error.
const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

// auth_session.active_role is constrained to passenger|driver|NULL (migration 0002); a
// 'guest'/unset role maps to NULL — only a granted role rides on the session.
const sessionRole = (user) => (
  ['passenger', 'driver'].includes(user.active_role)
  && Array.isArray(user.roles) && user.roles.includes(user.active_role)
    ? user.active_role : null
);

export default async function authService(app) {
  const { config } = app;

  // Loud, once-at-startup warning: dev-mode echoes the OTP in the HTTP response and skips SMS
  // — fine in dev/test, dangerous in production (anyone who can call /otp/request reads the
  // code). devMode defaults OFF in prod (config.js), so this only fires on an explicit
  // OTP_DEV_MODE=true in production.
  if (config.isProd && config.otp.devMode) {
    app.log.warn(
      'AUTH: OTP dev-mode is ON in production — codes are echoed in API responses and no SMS is sent. Set OTP_DEV_MODE=false.',
    );
  }

  app.get('/session', {
    schema: {
      response: {
        200: {
          type: 'object',
          required: ['user'],
          properties: {
            user: {
              type: ['object', 'null'],
              properties: {
                userId: { type: 'string' },
                sessionId: { type: 'string' },
                activeRole: { type: ['string', 'null'] },
                phoneVerified: { type: 'boolean' },
                // BD-AUTH-POLICY-01B-B — the account's CURRENT grants (additive field).
                roles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    // Resolve the session lazily — this is one of the few routes that NEEDS the actor, so
    // it opts into the DB lookup (operational/liveness routes never call resolveUser).
    const user = await req.resolveUser();
    // A presented token whose lookup FAILED (DB outage) is a retryable error, NOT a logout
    // — see plugins/auth.js. Anonymous (no token / no live session) stays { user: null }.
    if (req.authError) {
      return reply.code(503).send({
        error: 'session lookup failed',
        code: 'SESSION_LOOKUP_FAILED',
        retryable: true,
      });
    }
    if (!user) return { user: null };
    // Current grants come from the account row, not the session snapshot (a revoked grant shows
    // at once). A failed read is retryable, never a silent "no roles".
    let account;
    try {
      account = await findUserAuthorityById(app.db, user.userId);
    } catch {
      return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    }
    return { user: { ...user, roles: Array.from(account?.roles ?? []) } };
  });

  app.register(async logoutApp => {
    // Only logout accepts zero-byte JSON framing; non-empty JSON uses Fastify's parser.
    const parseJson = logoutApp.getDefaultJsonParser(
      app.initialConfig.onProtoPoisoning, app.initialConfig.onConstructorPoisoning,
    );
    logoutApp.removeContentTypeParser('application/json');
    logoutApp.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      if (body.length === 0) return done(null, undefined);
      return parseJson(req, body, done);
    });

    logoutApp.post('/logout', {
      // Reject all client-selected targets before validation or session lookup.
      preValidation: async (req, reply) => {
        if (req.body !== undefined || Object.keys(req.query).length > 0) {
          return problem(reply, 400, 'VALIDATION', 'logout requires no body or query parameters');
        }
      },
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['ok'],
            properties: { ok: { type: 'boolean', const: true } },
          },
        },
      },
    }, async (req, reply) => {
      const user = await req.resolveUser();
      if (req.authError) {
        return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
      }
      if (user) {
        try {
          // Missing rows count as concurrent deletion success; never revoke siblings.
          await revokeSessionById(app.db, user.sessionId);
        } catch {
          req.log.warn('auth session revoke failed');
          return problem(reply, 503, 'SESSION_REVOKE_FAILED', 'session revoke failed', true);
        }
      }
      return { ok: true };
    });
  });

  // POST /otp/request — mint + store a hashed code for a phone; dev-mode echoes it.
  // NOTE (deferred, pre-go-live): this endpoint is intentionally UNTHROTTLED in R02. The
  // per-code attempt cap (verify) is NOT a per-phone brute-force ceiling — re-requesting mints a
  // fresh code with attempts=0 — and there is no per-phone/IP rate limit yet (OTP policy is
  // deferred per BD-DOCS-032; the SMS provider is also still dark). A request-side rate limiter
  // is a REQUIRED hardening step before real delivery goes live (epic #784, R14/R19).
  // BD-STAND-PUBLIC-01 (#1124): on a public stand OTP is off entirely. Both OTP routes answer
  // 403 OTP_DISABLED in onRequest: no body parsing or validation, no code minted, no DB read
  // or write. Sign-in there is Telegram only (BD-AUTH-TELEGRAM-01 #1127).
  const otpDisabledGuard = config.publicExposure === true
    ? { onRequest: async (req, reply) => problem(reply, 403, 'OTP_DISABLED', 'Вход через Telegram') }
    : null;

  app.post('/otp/request', {
    ...otpDisabledGuard,
    schema: {
      body: {
        type: 'object',
        required: ['phone'],
        additionalProperties: false,
        properties: { phone: { type: 'string', minLength: 1, maxLength: 32 } },
      },
      response: {
        200: {
          type: 'object',
          required: ['ok', 'expiresInSeconds'],
          properties: {
            ok: { type: 'boolean' },
            expiresInSeconds: { type: 'integer' },
            devCode: { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const phone = normalizePhone(req.body.phone);
    if (!isValidPhone(phone)) {
      return problem(reply, 400, 'INVALID_PHONE', 'invalid phone number');
    }
    const code = generateOtpCode(config.otp.length);
    const expiresAt = new Date(Date.now() + config.otp.ttlSeconds * 1000);
    await insertOtp(app.db, {
      phone,
      codeHash: hashOtpCode(code),
      expiresAt,
      requestedIp: req.ip ?? null,
    });
    const out = { ok: true, expiresInSeconds: config.otp.ttlSeconds };
    // Echo the code ONLY in dev-mode (the sole delivery channel in R02); never in prod.
    if (config.otp.devMode) out.devCode = code;
    return reply.send(out);
  });

  // POST /otp/verify — check the code under the attempt cap; on success consume it once and
  // mint a verified session (all-or-nothing in one transaction).
  app.post('/otp/verify', {
    ...otpDisabledGuard,
    schema: {
      body: {
        type: 'object',
        required: ['phone', 'code'],
        additionalProperties: false,
        properties: {
          phone: { type: 'string', minLength: 1, maxLength: 32 },
          code: { type: 'string', minLength: 1, maxLength: 32 },
        },
      },
      response: {
        200: {
          type: 'object',
          required: ['token', 'user'],
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              required: ['userId', 'phoneVerified', 'activeRole', 'roles'],
              properties: {
                userId: { type: 'string' },
                activeRole: { type: ['string', 'null'] },
                phoneVerified: { type: 'boolean' },
                roles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const phone = normalizePhone(req.body.phone);
    if (!isValidPhone(phone)) {
      return problem(reply, 400, 'INVALID_PHONE', 'invalid phone number');
    }

    const otp = await findLatestLiveOtpByPhone(app.db, phone);
    // Same generic 401 body for "no live code" and "wrong code" — no account-existence oracle.
    // (A determined probe can still infer transient pending-OTP presence via the 429 lock / the
    // extra count write; that signal is self-inducible and bounded — see the header note.)
    if (!otp) {
      return problem(reply, 401, 'OTP_INVALID', 'invalid or expired code');
    }

    // COUNT this attempt atomically BEFORE comparing — the brute-force cap (the schema bakes no
    // threshold; the API owns it). incrementOtpAttempts is a single `UPDATE ... attempts =
    // attempts + 1 RETURNING attempts`, so concurrent verifies for the same code serialize on
    // the row lock and each observes a DISTINCT post-increment count — the cap therefore bounds
    // the number of guesses even under a concurrent burst. (A snapshot pre-check
    // `otp.attempts >= max` would be check-then-act: racers all read the same stale count and
    // slip past, defeating the cap. Counting first closes that TOCTOU — the same shape as
    // markOtpConsumed's atomic recheck that closed the R01 #787 consume race.) The count
    // persists even when we then reject a wrong code, so the cap is always reachable.
    const attempts = await incrementOtpAttempts(app.db, otp.id);
    if (attempts === null) {
      // Row vanished between the read and the count (reaped/superseded) — treat as no live code.
      return problem(reply, 401, 'OTP_INVALID', 'invalid or expired code');
    }
    if (attempts > config.otp.maxAttempts) {
      return problem(reply, 429, 'OTP_LOCKED', 'too many attempts — request a new code');
    }
    if (!hashesEqual(hashOtpCode(req.body.code), otp.code_hash)) {
      return problem(reply, 401, 'OTP_INVALID', 'invalid or expired code');
    }

    // Correct code: consume + identity + session, atomically. markOtpConsumed re-checks
    // not-consumed, not-expired, AND not-superseded (no strictly-newer code for the phone) in one
    // atomic statement — so if the code was consumed / expired / replaced between our live read
    // and now, it returns null, we roll the whole tx back, and NO session is minted from an
    // already-used / expired / superseded code (Codex #787 P2, #788).
    const expiresAt = (config.session?.ttlSeconds ?? 0) > 0
      ? new Date(Date.now() + config.session.ttlSeconds * 1000)
      : null;
    const token = generateToken();
    // The tab's current bearer, if any (the client transport attaches it). Only its hash is used.
    const presented = bearerToken(req.headers?.authorization);
    let result;
    try {
      result = await app.db.tx(async (client) => {
        const consumed = await markOtpConsumed(client, otp.id);
        if (!consumed) return null;
        const verified = await resolveVerifiedLoginUser(client, { phone });
        // Same-account session replacement (BD-AUTH-POLICY-01B-B, CWE-613): a presented LIVE
        // session of THIS account is revoked in this transaction. Missing / revoked / expired
        // presented sessions are ignored; another account's session is left alone (B2-C).
        if (presented) {
          try {
            const previous = await resolveLiveSessionByTokenHash(client, hashToken(presented));
            if (previous && String(previous.user_id) === String(verified.id)) {
              await revokeSessionById(client, previous.id);
            }
          } catch (err) {
            throw new SessionReplacementError('session replacement failed', { cause: err });
          }
        }
        const session = await insertSession(client, {
          userId: verified.id,
          tokenHash: hashToken(token),
          activeRole: sessionRole(verified),
          phoneVerified: true,
          otpId: otp.id,
          expiresAt,
        });
        return { user: verified, session };
      });
    } catch (err) {
      if (err instanceof SessionReplacementError) {
        req.log.warn('auth session replacement failed');
        return problem(reply, 503, 'SESSION_REPLACEMENT_FAILED', 'session replacement failed', true);
      }
      throw err;
    }
    if (!result) {
      return problem(reply, 401, 'OTP_INVALID', 'invalid or expired code');
    }

    return reply.send({
      token,
      user: {
        userId: result.user.id,
        activeRole: result.session.active_role ?? null,
        phoneVerified: result.user.phone_verified === true,
        roles: result.user.roles ?? [],
      },
    });
  });

  // PUT /session/active-role — switch THIS session to one of the account's current grants
  // (BD-AUTH-POLICY-01B-B; docs/driver-role-grant-contract.md §2). One transaction updates the
  // current session's active_role and users.active_role (which seeds the next login). Other
  // sessions keep theirs; there is no token rotation (#829). Same role -> 200, no write.
  app.put('/session/active-role', {
    schema: {
      body: {
        type: 'object',
        required: ['activeRole'],
        additionalProperties: false,
        properties: { activeRole: { type: 'string', enum: SWITCHABLE_ROLES } },
      },
      response: {
        200: {
          type: 'object',
          required: ['user'],
          properties: {
            user: {
              type: 'object',
              required: ['userId', 'sessionId', 'activeRole', 'phoneVerified', 'roles'],
              properties: {
                userId: { type: 'string' },
                sessionId: { type: 'string' },
                activeRole: { type: 'string' },
                phoneVerified: { type: 'boolean' },
                roles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const viewer = await req.resolveUser();
    if (req.authError) {
      return problem(reply, 503, 'SESSION_LOOKUP_FAILED', 'session lookup failed', true);
    }
    if (!viewer) return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    const role = req.body.activeRole;
    let outcome;
    try {
      outcome = await app.db.tx(async (client) => {
        // Lock order user -> session, the same as verify and the enrollment decisions.
        const account = await lockUserForGrant(client, viewer.userId);
        if (!account) return { code: 'UNAUTHENTICATED' };
        // Re-read THIS session under a lock: the request-time snapshot may be stale (a concurrent
        // switch) or the session may have been revoked since (a logout). The locked row decides
        // both liveness and the no-op.
        const session = await lockLiveSessionById(client, viewer.sessionId);
        if (!session || String(session.user_id) !== String(account.id)) return { code: 'UNAUTHENTICATED' };
        if (session.phone_verified !== true || account.phone_verified !== true) return { code: 'PHONE_NOT_VERIFIED' };
        const roles = Array.from(account.roles ?? []);
        if (!roles.includes(role)) return { code: 'ROLE_NOT_GRANTED' };
        if (session.active_role !== role) await setSessionActiveRole(client, session.id, role);
        if (account.active_role !== role) await setUserActiveRole(client, account.id, role);
        return { code: 'OK', roles };
      });
    } catch {
      req.log.warn('auth active-role switch failed');
      return problem(reply, 503, 'ROLE_SWITCH_FAILED', 'active role switch failed', true);
    }
    if (outcome.code === 'UNAUTHENTICATED') return problem(reply, 401, 'UNAUTHENTICATED', 'authentication required');
    if (outcome.code === 'PHONE_NOT_VERIFIED') return problem(reply, 403, 'PHONE_NOT_VERIFIED', 'a verified phone is required');
    if (outcome.code === 'ROLE_NOT_GRANTED') return problem(reply, 403, 'ROLE_NOT_GRANTED', `the account does not hold the ${role} role`);
    return {
      user: {
        userId: viewer.userId,
        sessionId: viewer.sessionId,
        activeRole: role,
        phoneVerified: true,
        roles: outcome.roles,
      },
    };
  });
}
