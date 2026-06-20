// /server/src/plugins/auth.js — the session-resolution SEAM (BD-DOCS-032 / ADR
// BD-DOCS-041), LAZY. It decorates request.user (null) + request.authError (false) and a
// request.resolveUser() method. Resolution is deferred to the routes that actually need a
// session: ONLY a handler that calls `await req.resolveUser()` hits the DB. This keeps
// operational/liveness paths (/health, /readyz, /metrics, the dark services) strictly
// no-I/O even when the caller sends an Authorization header — a global onRequest lookup
// would make /health block on the pool's connect timeout during a DB outage.
//
// resolveUser(): if a Bearer token is presented, hash it and resolve a LIVE auth_session
// (repositories/sessions.js), attaching request.user; on a lookup THROW (DB outage) it
// records request.authError (the live /auth/session endpoint turns that into a retryable
// error, never a silent logout). The result promise is memoized per request. The token
// MINTING side (OTP verify) lands with the auth service's write endpoints in the next PR.
import fp from 'fastify-plugin';

import { hashToken } from '../services/auth/tokens.js';
import { resolveLiveSessionByTokenHash } from '../repositories/sessions.js';

async function authPlugin(app) {
  app.decorateRequest('user', null);
  app.decorateRequest('authError', false);
  app.decorateRequest('_userPromise', null);

  app.decorateRequest('resolveUser', function resolveUser() {
    if (this._userPromise) return this._userPromise; // memoize per request
    const req = this;
    req._userPromise = (async () => {
      const token = bearerToken(req.headers?.authorization);
      if (!token) return req.user; // anonymous — no DB hit
      try {
        const session = await resolveLiveSessionByTokenHash(app.db, hashToken(token));
        if (session) {
          req.user = {
            userId: session.user_id,
            sessionId: session.id,
            activeRole: session.active_role ?? null,
            phoneVerified: session.phone_verified === true,
          };
        }
      } catch (err) {
        // Surfaced as a retryable error by the session endpoint — never a silent logout,
        // and never thrown here (a global throw would break liveness for token-bearing reqs).
        req.log?.warn?.({ err }, 'auth session resolve failed');
        req.authError = true;
      }
      return req.user;
    })();
    return req._userPromise;
  });
}

function bearerToken(authHeader) {
  if (typeof authHeader !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : '';
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] });
