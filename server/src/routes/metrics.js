// /server/src/routes/metrics.js — /metrics endpoint (ADR BD-DOCS-041 -> #9 monitoring),
// SKELETON. A Prometheus/pino-backed exporter lands with the monitoring phase; until then
// it returns 501 so the path is reachable and obviously dark.
export default async function metricsRoutes(app) {
  app.get('/metrics', async (req, reply) => reply.code(501).send({
    error: 'metrics exporter is not implemented yet',
    code: 'NOT_IMPLEMENTED',
    retryable: false,
  }));
}
