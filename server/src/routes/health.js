// /server/src/routes/health.js — liveness + readiness (ADR BD-DOCS-041 -> #9 monitoring).
//   GET /api/v1/health : liveness — always 200 if the process is up (no I/O).
//   GET /api/v1/readyz : readiness — verifies DB connectivity AND that migrations are
//                        applied (schema present); 200 only when truly ready, else 503,
//                        with a { db } field ('up' | 'schema-incomplete' | 'down').
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
    let db = 'down'; // cannot connect
    try {
      db = (await app.db.ready()) ? 'up' : 'schema-incomplete'; // connected; migrations?
    } catch (err) {
      req.log?.warn?.({ err }, 'readyz check failed');
    }
    const ready = db === 'up';
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'degraded', db });
  });
}
