// /server/src/routes/health.js — liveness + readiness (ADR BD-DOCS-041 -> #9 monitoring).
//   GET /api/v1/health : liveness — always 200 if the process is up (no I/O).
//   GET /api/v1/readyz : readiness — pings the DB; 200 when reachable, 503 when not, with
//                        a { db } field either way so a probe gets a deterministic body.
export default async function healthRoutes(app) {
  app.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string' },
            service: { type: 'string' },
          },
        },
      },
    },
  }, async () => ({ status: 'ok', service: '@bazardrive/server' }));

  app.get('/readyz', async (req, reply) => {
    let dbUp = false;
    try {
      dbUp = await app.db.ping();
    } catch (err) {
      req.log?.warn?.({ err }, 'readyz db ping failed');
    }
    return reply
      .code(dbUp ? 200 : 503)
      .send({ status: dbUp ? 'ready' : 'degraded', db: dbUp ? 'up' : 'down' });
  });
}
