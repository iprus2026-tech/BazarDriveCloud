// /server/src/routes/webhooks/whatsapp.js — BD-DOCS-051 WhatsApp Business Account adapter seam.
//
// GET  /api/v1/webhooks/whatsapp — Meta webhook subscription verification (live).
// POST /api/v1/webhooks/whatsapp — Inbound message event (dark, 501 until intake slice ships).
//
// The GET handler is intentionally unauthenticated: Meta calls it with no BazarDrive session.
// The POST handler will require HMAC-SHA256 signature verification (WABA_APP_SECRET) before
// being promoted to live; accepting unsigned payloads in production is not permitted.
//
// subject_namespace for WHATSAPP channel:
//   "waba:{WABA_ID}:phone:{WABA_PHONE_NUMBER_ID}"
// canonical_subject_key: sender's WA ID normalized to E.164 via auth/phone.js canonicalization.

import { hashToken, hashesEqual } from '../../services/auth/tokens.js';

export default async function whatsappWebhookRoutes(app) {
  // GET — Meta subscription verification challenge.
  // logLevel:'warn' suppresses Fastify's automatic info-level request log, which would
  // otherwise emit hub.verify_token as part of req.url in production stdout.
  app.get('/whatsapp', { logLevel: 'warn' }, async (req, reply) => {
    const mode = req.query['hub.mode'];
    const verifyToken = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe') {
      return reply.code(400).send({
        error: 'invalid hub.mode; expected "subscribe"',
        code: 'INVALID_WEBHOOK_MODE',
        retryable: false,
      });
    }

    const configuredToken = app.config.waba?.webhookVerifyToken || '';
    // Compare SHA-256 digests in constant time: a plain `!==` on the raw strings
    // leaks, via timing, how many leading characters of the long-lived verify token
    // an attacker's guess matched. `hub.verify_token` must be a string — reject a
    // missing value (`undefined`) or a repeated query parameter (parsed as an array)
    // *before* hashing, because `hashToken()` runs `String(...)` and would otherwise
    // fold `"undefined"` / `"a,b"` into a valid-looking 64-char digest. The empty
    // configured-token refusal short-circuits ahead of any hashing.
    if (
      !configuredToken ||
      typeof verifyToken !== 'string' ||
      !hashesEqual(hashToken(verifyToken), hashToken(configuredToken))
    ) {
      return reply.code(403).send({
        error: 'webhook verification failed',
        code: 'WEBHOOK_VERIFICATION_FAILED',
        retryable: false,
      });
    }

    return reply.code(200).type('text/plain').send(challenge ?? '');
  });

  // POST — inbound message event (dark until BD-WHATSAPP-INTAKE-01B).
  app.post('/whatsapp', async (req, reply) => {
    return reply.code(501).send({
      error: 'WhatsApp message processing is not implemented yet',
      code: 'NOT_IMPLEMENTED',
      retryable: false,
      service: 'whatsapp-webhook',
      phase: 'BD-DOCS-051 — intake dark; awaiting BD-WHATSAPP-INTAKE-01B',
    });
  });
}
