// /server/src/infra/logger.js — pino logger options for Fastify (feeds the #9 monitoring
// layer, ADR BD-DOCS-041). No transport/pretty dependency in Phase 1 (minimal-deps rule):
// structured JSON to stdout. `redact` keeps secrets/tokens/codes out of logs (BD-DOCS-032:
// auth material is never logged, just as it is never cached). Returns `false` to disable
// logging entirely under tests.
export function loggerOptions(config) {
  if (config.logLevel === 'silent') return false;
  return {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.token',
        '*.token_hash',
        '*.code',
        '*.code_hash',
        '*.sessionSecret',
      ],
      remove: true,
    },
  };
}
