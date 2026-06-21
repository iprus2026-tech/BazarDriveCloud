// /server/src/services/_skeleton.js — shared skeleton for a not-yet-implemented
// Mini-Yonder service (ADR BD-DOCS-041: "each a one-line skeleton plugin that registers
// its prefix and returns 501 until implemented"). It registers a catch-all under the
// service's mounted prefix so the whole service surface is reachable and reports its own
// phase in the uniform problem shape. Promoting the service replaces its index.js with
// real routes — this helper is then unused by it.
export function darkService(name, phase) {
  return async function service(app) {
    const handler = async (req, reply) => reply.code(501).send({
      error: `service "${name}" is not implemented yet`,
      code: 'NOT_IMPLEMENTED',
      retryable: false,
      service: name,
      phase,
    });
    app.all('/', handler);   // the bare prefix (ignoreTrailingSlash covers the slash form)
    app.all('/*', handler);  // any sub-path under the prefix
  };
}
