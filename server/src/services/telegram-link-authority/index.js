// BD-TELEGRAM-ASSISTANT-01B — DARK internal authority. No registered HTTP routes.
// Token / actor verification precedes account binding; all authority writes + audit
// are transactional. This module never grants a role or mints auth_session tokens.
// readOwnProfile is the ONLY delegated read here; no general impersonation bridge.
// Public login/OTP policy, HTTP guards, ingress, delivery, domain reads and cleanup
// remain activation gates. Verified actor objects come ONLY from actor.js.
import { randomInt } from 'node:crypto';
import { generateToken, hashToken, hashesEqual } from '../auth/tokens.js';
import { lockLiveSessionByTokenHash, lockLiveSessionById, readAuthorizationClock } from '../../repositories/sessions.js';
import { lockUserAuthority } from '../../repositories/users.js';
import * as repo from '../../repositories/telegram_links.js';
import { canonicalTelegramId, validateNamespace, isPrivateActor } from './actor.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validId = id => typeof id === 'string' && UUID.test(id);
const validEpoch = n => typeof n === 'string' && /^[1-9][0-9]{0,18}$/.test(n) && BigInt(n) <= 9223372036854775807n;
const fail = code => ({ ok: false, code });
const requestView = r => ({ requestId: r.id, state: r.state, expiresAt: r.expires_at,
  candidateTelegramId: r.candidate_id, comparisonCode: r.candidate_id ? r.comparison_code : null });
const linkView = r => ({ linkId: r.id, epoch: String(r.epoch), status: r.status, expiresAt: r.grant_expires_at });

export function createTelegramLinkAuthority(db, namespace) {
  const scope = validateNamespace(namespace);
  if (typeof db?.tx !== 'function') throw new TypeError('A transactional database is required');
  const tx = fn => db.tx(async client => { await repo.lockNamespace(client, scope); return fn(client); });
  const actorTx = (actor, fn) => tx(client => isPrivateActor(actor, scope)
    ? fn(client) : fail('CHANNEL_PROOF_REQUIRED'));

  async function account(client, bearer, fresh = false) {
    if (typeof bearer !== 'string' || bearer.length < 16 || bearer.length > 512) return null;
    const session = await lockLiveSessionByTokenHash(client, hashToken(bearer));
    if (!session || !session.phone_verified || (fresh && !session.recent)) return null;
    const user = await lockUserAuthority(client, session.user_id);
    if (!user || !user.phone_verified) return null;
    const now = +await readAuthorizationClock(client);
    if ((session.expires_at && +session.expires_at <= now)
      || (fresh && +session.issued_at < now - 900_000)) return null;
    return { session, user };
  }

  return Object.freeze({
    async createRequest({ bearer } = {}) {
      return tx(async client => {
        const who = await account(client, bearer, true);
        if (!who) return fail('AUTH_REQUIRED');
        if (await repo.activeConflict(client, scope, who.user.id)) return fail('LINK_CONFLICT');
        if (!await repo.createRateAllowed(client, scope, who.user.id)) return fail('RATE_LIMITED');
        await repo.cancelPending(client, scope, who.user.id);
        const nonce = generateToken();
        const r = await repo.insertRequest(client, scope, { accountId: who.user.id,
          sessionId: who.session.id, tokenHash: hashToken(nonce),
          comparisonCode: String(randomInt(0, 1_000_000)).padStart(6, '0') });
        await repo.appendAudit(client, scope, 'REQUESTED', { requestId: r.id, sessionId: who.session.id });
        return { ok: true, ...requestView(r), startParameter: `link_${nonce}` };
      });
    },

    async claimRequest({ actor, nonce } = {}) {
      if (!isPrivateActor(actor, scope)) return fail('CHANNEL_PROOF_REQUIRED');
      // Hash the actor for rate accounting; never store a provider payload or secret.
      const actorHash = hashToken(`${scope.environment}:${scope.botId}:${actor.telegramUserId}`);
      return actorTx(actor, async client => {
        if (!await repo.claimRateAllowed(client, scope, actorHash)) return fail('RATE_LIMITED');
        await repo.appendAudit(client, scope, 'CLAIM_ATTEMPT', { actorHash });
        if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return fail('LINK_REQUEST_INVALID');
        let r = await repo.lockRequestByHash(client, scope, hashToken(nonce));
        if (!r || !['PENDING','CLAIMED'].includes(r.state)) return fail('LINK_REQUEST_INVALID');
        if (r.expired) { await repo.expireRequest(client, r.id); return fail('LINK_REQUEST_EXPIRED'); }
        if (r.candidate_id && r.candidate_id !== actor.telegramUserId) return fail('LINK_REQUEST_INVALID');
        if (r.state === 'PENDING') {
          r = await repo.claimRequest(client, r.id, actor.telegramUserId);
          if (!r) return fail('LINK_REQUEST_EXPIRED');
          await repo.appendAudit(client, scope, 'CLAIMED', { requestId: r.id, actorHash });
        }
        // No account/session identifiers or account data in the Telegram claim reply.
        return { ok: true, ...requestView(r) };
      });
    },

    async getRequest({ bearer, requestId } = {}) {
      if (!validId(requestId)) return fail('LINK_REQUEST_INVALID');
      return tx(async client => {
        const who = await account(client, bearer);
        if (!who) return fail('AUTH_REQUIRED');
        const r = await repo.lockRequestById(client, scope, requestId);
        if (!r || r.session_id !== who.session.id || r.account_id !== who.user.id) return fail('LINK_REQUEST_INVALID');
        if (r.expired && ['PENDING','CLAIMED'].includes(r.state)) {
          await repo.expireRequest(client, r.id); r.state = 'EXPIRED';
        }
        return { ok: true, ...requestView(r) };
      });
    },

    async confirmRequest({ bearer, requestId, candidateTelegramId, comparisonCode } = {}) {
      if (!validId(requestId)) return fail('LINK_REQUEST_INVALID');
      return tx(async client => {
        const who = await account(client, bearer, true);
        if (!who) return fail('AUTH_REQUIRED');
        const r = await repo.lockRequestById(client, scope, requestId);
        if (!r || r.session_id !== who.session.id || r.account_id !== who.user.id) return fail('LINK_REQUEST_INVALID');
        const candidate = canonicalTelegramId(candidateTelegramId);
        const matches = candidate === r.candidate_id && typeof comparisonCode === 'string'
          && /^[0-9]{6}$/.test(comparisonCode) && hashesEqual(comparisonCode, r.comparison_code);
        if (r.state === 'CONFIRMED') {
          const link = await repo.findLinkForRequest(client, scope, r.id);
          return matches && link?.status === 'ACTIVE' && !link.expired
            ? { ok: true, ...linkView(link) } : fail('LINK_REQUEST_INVALID');
        }
        if (r.state !== 'CLAIMED') return fail('LINK_REQUEST_INVALID');
        if (r.expired) { await repo.expireRequest(client, r.id); return fail('LINK_REQUEST_EXPIRED'); }
        if (!matches) {
          await repo.rejectConfirm(client, r.id);
          await repo.appendAudit(client, scope, 'CONFIRM_REJECTED', { requestId: r.id, sessionId: who.session.id });
          return fail('CONFIRMATION_MISMATCH');
        }
        if (await repo.activeConflict(client, scope, who.user.id, r.candidate_id)) return fail('LINK_CONFLICT');
        if (!await repo.confirmRequest(client, r.id)) return fail('LINK_REQUEST_EXPIRED');
        const link = await repo.insertLink(client, r.id, who.session.expires_at);
        await repo.appendAudit(client, scope, 'CONFIRMED', { requestId: r.id, linkId: link.id, sessionId: who.session.id });
        await repo.cancelPending(client, scope, who.user.id, r.id);
        return { ok: true, ...linkView(link) };
      });
    },

    async readOwnProfile({ actor, linkId, epoch, role } = {}) {
      if (!isPrivateActor(actor, scope)) return fail('CHANNEL_PROOF_REQUIRED');
      if (!validId(linkId) || !validEpoch(epoch) || !['passenger','driver'].includes(role)) return fail('FORBIDDEN');
      return actorTx(actor, async client => {
        const link = await repo.lockLink(client, scope, linkId);
        if (!link || link.telegram_user_id !== actor.telegramUserId || link.private_chat_id !== actor.privateChatId
          || link.status !== 'ACTIVE' || String(link.epoch) !== epoch || link.expired) return fail('AUTH_REQUIRED');
        const session = await lockLiveSessionById(client, link.session_id);
        if (!session || session.user_id !== link.account_id || !session.phone_verified) return fail('AUTH_REQUIRED');
        const user = await lockUserAuthority(client, session.user_id);
        if (!user || !user.phone_verified || !user.roles?.includes(role)) return fail('FORBIDDEN');
        const now = +await readAuthorizationClock(client);
        if (+link.grant_expires_at <= now || (session.expires_at && +session.expires_at <= now)) return fail('AUTH_REQUIRED');
        // Narrow current read result, NOT a bearer/delegated credential. No endpoint
        // may reuse this snapshot as authorization for a later mutation or send.
        return { ok: true, ...linkView(link), profile: {
          userId: user.id, activeRole: role, roles: user.roles.filter(r => ['passenger','driver'].includes(r)),
        } };
      });
    },

    async revokeFromTelegram({ actor, linkId, epoch } = {}) {
      if (!isPrivateActor(actor, scope)) return fail('CHANNEL_PROOF_REQUIRED');
      if (!validId(linkId) || !validEpoch(epoch)) return fail('FORBIDDEN');
      return actorTx(actor, async client => {
        const link = await repo.lockLink(client, scope, linkId);
        if (!link || link.telegram_user_id !== actor.telegramUserId || link.private_chat_id !== actor.privateChatId) return fail('FORBIDDEN');
        if (link.status === 'REVOKED') return { ok: true, ...linkView(link) };
        if (String(link.epoch) !== epoch) return fail('STALE_LINK');
        return revoke(client, link, { actorHash: hashToken(`${scope.environment}:${scope.botId}:${actor.telegramUserId}`) });
      });
    },

    async revokeFromAccount({ bearer, linkId } = {}) {
      if (!validId(linkId)) return fail('FORBIDDEN');
      return tx(async client => {
        const who = await account(client, bearer);
        if (!who) return fail('AUTH_REQUIRED');
        const link = await repo.lockLink(client, scope, linkId);
        if (!link || link.account_id !== who.user.id) return fail('FORBIDDEN');
        if (link.status === 'REVOKED') return { ok: true, ...linkView(link) };
        return revoke(client, link, { sessionId: who.session.id });
      });
    },
  });

  async function revoke(client, link, provenance) {
    const revoked = await repo.revokeLink(client, link.id);
    await repo.cancelPending(client, scope, link.account_id);
    await repo.appendAudit(client, scope, 'REVOKED', { linkId: link.id, requestId: link.request_id, ...provenance });
    return { ok: true, ...linkView(revoked) };
  }
}
