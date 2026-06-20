// /server/src/plugins/cors.js — @fastify/cors locked to the single ALLOWED_ORIGIN (the
// GitHub Pages origin) — the CORS mirror of the client CSP connect-src exact-origin change
// (ADR BD-DOCS-041). When ALLOWED_ORIGIN is unset (dev/test), CORS is left OFF =>
// same-origin only. NEVER a wildcard. Registered via fastify-plugin so it applies app-wide.
import fp from 'fastify-plugin';
import cors from '@fastify/cors';

async function corsPlugin(app) {
  const origin = app.config.allowedOrigin;
  if (!origin) {
    app.log?.warn?.('ALLOWED_ORIGIN unset — CORS disabled (same-origin only)');
    return;
  }
  await app.register(cors, {
    origin: [origin],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
}

export default fp(corsPlugin, { name: 'cors' });
