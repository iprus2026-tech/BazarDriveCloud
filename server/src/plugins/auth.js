// /server/src/plugins/auth.js — the session-resolution SEAM (BD-DOCS-032 / ADR
// BD-DOCS-041). Decorates request.user. On every request, if a Bearer token is presented
// it is hashed and resolved against a LIVE auth_session row (repositories/sessions.js) and
// the identity is attached as request.user; otherwise request.user stays null (anonymous).
// This is the READ side of auth — the token-MINTING side (OTP verify) lands with the auth
// service's write endpoints in the next scoped PR, and mints tokens hashed through the
// same services/auth/tokens.js so resolution matches.
import fp from 'fastify-plugin';

import { hashToken } from '../services/auth/tokens.js';
import { resolveLiveSessionByTokenHash } from '../repositories/sessions.js';

async function authPlugin(app) {
  app.decorateRequest('user', null);
  // A token was presented but its session lookup FAILED (transient DB error) — distinct
  // from "no token" and from "no live session". The live /auth/session endpoint converts
  // this to a RETRYABLE error so a backend blip is not mistaken for a logout. We do NOT
  // throw here: that would 503 every token-bearing request, including liveness /health,
  // which must never depend on the DB. Routes that don't consume the session stay
  // fail-open anonymous.
  app.decorateRequest('authError', false);

  app.addHook('onRequest', async (req) => {
    const token = bearerToken(req.headers?.authorization);
    if (!token) return; // anonymous — no DB hit

    let session = null;
    try {
      session = await resolveLiveSessionByTokenHash(app.db, hashToken(token));
    } catch (err) {
      // Record the failure (the session endpoint surfaces it as retryable); never 500 a
      // request that doesn't need auth. Logged for #9 monitoring.
      req.log?.warn?.({ err }, 'auth session resolve failed');
      req.authError = true;
      return;
    }
    if (session) {
      req.user = {
        userId: session.user_id,
        sessionId: session.id,
        activeRole: session.active_role ?? null,
        phoneVerified: session.phone_verified === true,
      };
    }
  });
}

function bearerToken(authHeader) {
  if (typeof authHeader !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : '';
}

export default fp(authPlugin, { name: 'auth', dependencies: ['db'] });
