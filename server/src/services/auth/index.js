// /server/src/services/auth/index.js — BD-DOCS-032 phone+OTP + session service (ADR
// BD-DOCS-041 §API). All three routes are now LIVE (R02 of #784):
//   GET  /api/v1/auth/session       -> { user } (null when anonymous)            [LIVE]
//   POST /api/v1/auth/otp/request   -> { ok, expiresInSeconds, devCode? }        [LIVE]
//   POST /api/v1/auth/otp/verify    -> { token, user }                           [LIVE]
//
// request mints a numeric code, stores ONLY its hash (auth_otp), and — in dev-mode — echoes
// the plaintext in the response (there is no SMS provider yet; BD-DOCS-032 open question).
// verify resolves the freshest live code for the phone, enforces the attempt cap, compares
// the code in constant time, then (only on success) atomically consumes it, resolves a
// DISTINCT identity per phone (replacing the old identical pseudo-ids), stamps the phone
// verified, and mints an opaque bearer session — storing only the token HASH and returning
// the plaintext exactly once. Each attempt is COUNTED atomically (a single UPDATE) before the
// compare, so the cap bounds guesses even under a concurrent burst; a generic "invalid or
// expired code" 401 never reveals whether the phone or code existed (no enumeration oracle).
import { generateToken, generateOtpCode, hashOtpCode, hashToken, hashesEqual } from './tokens.js';
import { normalizePhone, isValidPhone } from './phone.js';
import { insertOtp, findLatestLiveOtpByPhone, markOtpConsumed, incrementOtpAttempts } from '../../repositories/otps.js';
import { upsertUserByPhone, markPhoneVerified } from '../../repositories/users.js';
import { insertSession } from '../../repositories/sessions.js';

// Uniform problem shape { error, code, retryable } — matches plugins/error-handler.js so the
// client loadResource overlay reads these the same as a thrown error.
const problem = (reply, status, code, error, retryable = false) =>
  reply.code(status).send({ error, code, retryable });

// auth_session.active_role is constrained to passenger|driver|NULL (migration 0002); a
// 'guest'/unset role maps to NULL — only a granted role rides on the session.
const sessionRole = (role) => (role === 'passenger' || role === 'driver' ? role : null);

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
    return { user: user ?? null };
  });

  // POST /otp/request — mint + store a hashed code for a phone; dev-mode echoes it.
  app.post('/otp/request', {
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
              required: ['userId', 'phoneVerified'],
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
    // Generic for BOTH "no live code" and "wrong code" — never reveal which (no phone/code
    // enumeration oracle).
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
    // not-consumed AND not-expired in the same statement, so if a concurrent verify already
    // consumed it (or it lapsed between the live read and now) it returns null, we roll the
    // whole tx back, and NO session is minted from an already-used/expired code.
    const expiresAt = (config.session?.ttlSeconds ?? 0) > 0
      ? new Date(Date.now() + config.session.ttlSeconds * 1000)
      : null;
    const token = generateToken();
    const result = await app.db.tx(async (client) => {
      const consumed = await markOtpConsumed(client, otp.id);
      if (!consumed) return null;
      const user = await upsertUserByPhone(client, { phone });
      const verified = await markPhoneVerified(client, user.id);
      const session = await insertSession(client, {
        userId: user.id,
        tokenHash: hashToken(token),
        activeRole: sessionRole(verified.active_role),
        phoneVerified: true,
        otpId: otp.id,
        expiresAt,
      });
      return { user: verified, session };
    });
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
}
