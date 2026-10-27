// /server/src/services/auth/telegram.js — BD-AUTH-TELEGRAM-01 M4 (#1127, ADR BD-DOCS-052).
//   POST /api/v1/auth/telegram -> { token, user }   sign in with Telegram Mini App initData
//   linkTelegramContact(...)                        the contact intake the bot (M6) calls
//
// Sign-in: the per-IP limit, the signature and auth_date window (domain/telegram-init-data.js),
// the per-Telegram-id limit, the one-time exchange, the identity, then a session — all in ONE
// transaction, so a session is never minted without consuming the initData and a failed mint
// never consumes it. No account is created here (R3): only a contact shared in the bot links one.
// Telegram never grants a role (#830): the session's role is the account's, as for OTP.
//
// R10: the request body is the raw initData. It is never logged — Fastify does not log bodies,
// and nothing below passes it (or the bot token, or a phone) to a logger.
import crypto from 'node:crypto';
import { verifyInitData } from '../../domain/telegram-init-data.js';
import { generateToken, hashToken } from './tokens.js';
import { normalizePhone, isValidPhone } from './phone.js';
import {
  lockTelegramKey, findTelegramIdentity, findTelegramIdentityByUser, insertTelegramIdentity,
  insertTelegramAttempt, setTelegramAttemptOutcome, telegramAttemptUsage, deleteOldTelegramAttempts,
} from '../../repositories/telegram.js';
import {
  findUserByPhone, findLoginUserById, resolveVerifiedLoginUser, fillUserFirstName,
} from '../../repositories/users.js';
import { insertSession, revokeSessionById, resolveLiveSessionByTokenHash } from '../../repositories/sessions.js';
import { bearerToken } from '../../plugins/auth.js';

// R8 — the limits, counted from auth_telegram_attempts over the last hour.
const ATTEMPT_WINDOW_SECONDS = 3600;
export const IP_ATTEMPTS_PER_HOUR = 30;
export const ID_ATTEMPTS_PER_HOUR = 10;
const SWEEP_BATCH = 100;

// R9 — the consent text version the bot shows on the requestContact message. The final wording
// and the policy page are #1154's; a new version does not invalidate existing links.
export const CONSENT_VERSION = '2026-10-privacy-v1';
// R5 — what the user is told on a conflict (the bot shows it).
export const CONFLICT_TEXT = 'Этот номер уже связан с другим Telegram. Напишите в поддержку.';

const OUTCOMES = {
  TELEGRAM_INVALID: 'invalid', TELEGRAM_EXPIRED: 'expired', TELEGRAM_NO_USER: 'no_user',
};

class SessionReplacementError extends Error {}

export function registerTelegramSignIn(app, { problem, rateLimited, sessionRole }) {
  const { config } = app;

  app.post('/telegram', {
    schema: {
      body: {
        type: 'object',
        required: ['initData'],
        additionalProperties: false,
        properties: { initData: { type: 'string', minLength: 1, maxLength: 4096 } },
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
                phoneVerified: { type: 'boolean' },
                activeRole: { type: ['string', 'null'] },
                roles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { botToken, initDataMaxAgeSeconds, sessionTtlSeconds } = config.telegram ?? {};
    if (!botToken) return problem(reply, 503, 'TELEGRAM_DISABLED', 'Telegram sign-in is not configured');
    const ip = req.ip || null;

    // R6 — the replay store is swept like auth_otp: kept for max age + the limit window. Best
    // effort, as for OTP: a failed sweep never fails a sign-in; the next request retries it.
    try {
      await deleteOldTelegramAttempts(app.db, {
        retentionSeconds: initDataMaxAgeSeconds + ATTEMPT_WINDOW_SECONDS, batch: SWEEP_BATCH,
      });
    } catch {
      req.log.warn('auth telegram attempts sweep failed');
    }

    const verdict = verifyInitData(req.body.initData, {
      botToken, nowSeconds: Math.floor(Date.now() / 1000), maxAgeSeconds: initDataMaxAgeSeconds,
    });
    const token = generateToken();
    const presented = bearerToken(req.headers?.authorization);

    let result;
    try {
      result = await app.db.tx(async (client) => {
        if (ip) {
          await lockTelegramKey(client, `ip:${ip}`);
          const byIp = await telegramAttemptUsage(client, {
            by: 'ip', value: ip, windowSeconds: ATTEMPT_WINDOW_SECONDS, max: IP_ATTEMPTS_PER_HOUR,
          });
          if (byIp.retryAfterSeconds) {
            await insertTelegramAttempt(client, { ip, outcome: 'rate_limited' });
            return { limited: byIp.retryAfterSeconds };
          }
        }
        if (!verdict.ok) {
          // An invalid signature is counted per IP only; an expired one is Telegram's own data.
          await insertTelegramAttempt(client, {
            ip, telegramUserId: verdict.code === 'TELEGRAM_EXPIRED' ? verdict.telegramUserId ?? null : null,
            outcome: OUTCOMES[verdict.code],
          });
          return { refused: verdict.code };
        }
        const telegramUserId = verdict.telegramUserId;
        await lockTelegramKey(client, `id:${telegramUserId}`);
        const byId = await telegramAttemptUsage(client, {
          by: 'telegramUserId', value: telegramUserId, windowSeconds: ATTEMPT_WINDOW_SECONDS, max: ID_ATTEMPTS_PER_HOUR,
        });
        if (byId.retryAfterSeconds) {
          await insertTelegramAttempt(client, { ip, telegramUserId, outcome: 'rate_limited' });
          return { limited: byId.retryAfterSeconds };
        }
        // R6 — the one-time exchange: only one attempt can carry this initData's hash.
        const initDataHash = crypto.createHash('sha256').update(verdict.hash).digest('hex');
        const attemptId = await insertTelegramAttempt(client, { ip, telegramUserId, initDataHash, outcome: 'ok' });
        if (!attemptId) {
          await insertTelegramAttempt(client, { ip, telegramUserId, outcome: 'replayed' });
          return { refused: 'TELEGRAM_REPLAYED' };
        }
        const identity = await findTelegramIdentity(client, telegramUserId);
        if (!identity) {
          await setTelegramAttemptOutcome(client, attemptId, 'phone_required');
          return { refused: 'PHONE_REQUIRED' };
        }
        if (identity.revoked_at) {
          await setTelegramAttemptOutcome(client, attemptId, 'revoked');
          return { refused: 'TELEGRAM_REVOKED' };
        }
        await fillUserFirstName(client, identity.user_id, verdict.firstName);
        const user = await findLoginUserById(client, identity.user_id);
        // R7 — same-account AND same-method replacement: a Telegram sign-in revokes a presented
        // live Telegram session of this account, never an OTP one (a browser stays signed in).
        if (presented) {
          try {
            const previous = await resolveLiveSessionByTokenHash(client, hashToken(presented));
            if (previous && String(previous.user_id) === String(user.id) && previous.auth_method === 'telegram') {
              await revokeSessionById(client, previous.id);
            }
          } catch (err) {
            throw new SessionReplacementError('session replacement failed', { cause: err });
          }
        }
        const session = await insertSession(client, {
          userId: user.id,
          tokenHash: hashToken(token),
          activeRole: sessionRole(user),
          phoneVerified: user.phone_verified === true,
          authMethod: 'telegram',
          expiresAt: new Date(Date.now() + sessionTtlSeconds * 1000),
        });
        return { user, session };
      });
    } catch (err) {
      if (err instanceof SessionReplacementError) {
        req.log.warn('auth session replacement failed');
        return problem(reply, 503, 'SESSION_REPLACEMENT_FAILED', 'session replacement failed', true);
      }
      throw err;
    }

    if (result.limited) {
      return rateLimited(reply, 'TELEGRAM_RATE_LIMITED', 'too many sign-in attempts — try again later', result.limited);
    }
    switch (result.refused) {
      case undefined: break;
      case 'TELEGRAM_INVALID': return problem(reply, 401, 'TELEGRAM_INVALID', 'invalid Telegram data');
      case 'TELEGRAM_EXPIRED': return problem(reply, 401, 'TELEGRAM_EXPIRED', 'Telegram data expired — reopen the app');
      case 'TELEGRAM_NO_USER': return problem(reply, 400, 'TELEGRAM_NO_USER', 'Telegram data has no user');
      case 'TELEGRAM_REPLAYED': return problem(reply, 409, 'TELEGRAM_REPLAYED', 'Telegram data already used — reopen the app');
      case 'PHONE_REQUIRED': return problem(reply, 403, 'PHONE_REQUIRED', 'share your phone number in the bot first');
      case 'TELEGRAM_REVOKED': return problem(reply, 403, 'TELEGRAM_REVOKED', 'Telegram sign-in is revoked for this account');
      default: throw new Error('unexpected Telegram sign-in result');
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

// R4/R5 — the contact intake. The bot (M6) calls it with a message's private-chat contact:
//   -> { ok: true, userId, linked }      linked=false when this Telegram id already had this phone
//    | { ok: false, code: 'NOT_PRIVATE' | 'INVALID_SENDER' | 'FOREIGN_CONTACT' | 'INVALID_PHONE'
//                         | 'TELEGRAM_REVOKED' | 'TELEGRAM_CONFLICT', conflict? }
// The phone becomes a verified phone of the account it belongs to (found or created by the OTP
// resolver), so an OTP account keeps its data. A conflict changes nothing; its log line carries
// only the ids and the conflict type — never the phone (R5).
export async function linkTelegramContact(db, { fromId, chatType, contact, consentVersion = CONSENT_VERSION, log = null }) {
  if (chatType !== 'private') return { ok: false, code: 'NOT_PRIVATE' };
  if (!Number.isSafeInteger(fromId) || fromId <= 0) return { ok: false, code: 'INVALID_SENDER' };
  if (!contact || contact.user_id !== fromId) return { ok: false, code: 'FOREIGN_CONTACT' };
  const phone = normalizePhone(typeof contact.phone_number === 'string' ? contact.phone_number : '');
  if (!isValidPhone(phone)) return { ok: false, code: 'INVALID_PHONE' };

  return db.tx(async (client) => {
    // Always the id lock first, then the phone lock: two contacts never wait on each other in
    // opposite orders.
    await lockTelegramKey(client, `id:${fromId}`);
    await lockTelegramKey(client, `phone:${phone}`);
    const conflict = (userId, type) => {
      log?.warn({ userId, telegramUserId: fromId, conflict: type }, 'telegram contact conflict');
      return { ok: false, code: 'TELEGRAM_CONFLICT', conflict: type };
    };
    const existing = await findTelegramIdentity(client, fromId);
    if (existing) {
      if (existing.revoked_at) return { ok: false, code: 'TELEGRAM_REVOKED' };
      const linkedUser = await findLoginUserById(client, existing.user_id);
      if (linkedUser?.phone === phone) return { ok: true, userId: linkedUser.id, linked: false };
      return conflict(existing.user_id, 'phone_changed');
    }
    const owner = await findUserByPhone(client, phone);
    if (owner && await findTelegramIdentityByUser(client, owner.id)) {
      return conflict(owner.id, 'phone_linked_elsewhere');
    }
    const user = await resolveVerifiedLoginUser(client, { phone });
    await insertTelegramIdentity(client, { telegramUserId: fromId, userId: user.id, consentVersion });
    return { ok: true, userId: user.id, linked: true };
  });
}
