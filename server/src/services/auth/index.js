// /server/src/services/auth/index.js — BD-DOCS-032 phone+OTP + session service (ADR
// BD-DOCS-041 §API). Phase-1 scaffold: the SESSION read endpoint is LIVE (backed by the
// resolution seam in plugins/auth.js); the OTP request/verify WRITE endpoints are declared
// (so the surface is reachable and pinned) but return 501 — their code-hashing, attempt
// caps, and session issuance land in the next scoped PR. Routes:
//   GET  /api/v1/auth/session       -> { user } (null when anonymous)   [LIVE]
//   POST /api/v1/auth/otp/request   -> send a code to a phone            [501, next PR]
//   POST /api/v1/auth/otp/verify    -> consume a code, mint a session    [501, next PR]
const notImplemented = (reply, what) => reply.code(501).send({
  error: `${what} is not implemented yet`,
  code: 'NOT_IMPLEMENTED',
  retryable: false,
});

export default async function authService(app) {
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

  app.post('/otp/request', async (req, reply) => notImplemented(reply, 'OTP request'));
  app.post('/otp/verify', async (req, reply) => notImplemented(reply, 'OTP verify'));
}
