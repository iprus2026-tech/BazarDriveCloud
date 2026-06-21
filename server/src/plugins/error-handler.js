// /server/src/plugins/error-handler.js — the uniform problem shape { error, code,
// retryable } for every error and 404 (ADR BD-DOCS-041 §API). This maps directly onto the
// client loadResource server_error/retry overlay (BD-ERROR-02A): `retryable` drives the
// «Повторить» button. 5xx (and 429) are retryable; other 4xx are not. 5xx messages are
// generic (never leak internals); validation errors surface as 400 VALIDATION.
import fp from 'fastify-plugin';

async function errorHandlerPlugin(app) {
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({
      error: `route ${req.method} ${req.url} not found`,
      code: 'NOT_FOUND',
      retryable: false,
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const status = Number.isInteger(err.statusCode) && err.statusCode >= 400
      ? err.statusCode
      : 500;
    if (status >= 500) req.log?.error?.({ err }, 'request failed');

    let code;
    if (err.validation) code = 'VALIDATION';
    else if (status === 404) code = 'NOT_FOUND';
    else if (status >= 500) code = 'INTERNAL';
    else code = err.code || 'BAD_REQUEST';

    const retryable = status >= 500 || status === 429;
    const message = status >= 500 ? 'internal server error' : (err.message || 'request error');

    reply.code(status).send({ error: message, code, retryable });
  });
}

export default fp(errorHandlerPlugin, { name: 'error-handler' });
