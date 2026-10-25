// /server/src/plugins/cors.js — @fastify/cors locked to the single ALLOWED_ORIGIN (the
// GitHub Pages origin) — the CORS mirror of the client CSP connect-src exact-origin change
// (ADR BD-DOCS-041). When ALLOWED_ORIGIN is unset (dev/test), CORS is left OFF =>
// same-origin only. NEVER a wildcard: loadConfig() validates ALLOWED_ORIGIN is a single
// exact http(s) origin and rejects "*" at startup, so the value handed to @fastify/cors
// below is already wildcard-free. Registered via fastify-plugin so it applies app-wide.
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
    // Auth is Bearer-only (no cookies), but the client still fetches with credentials:'include'
    // (public/src/api_client.js). Turning this off would make the browser drop every
    // cross-origin response, so it stays on until the client switches to 'omit' (#1124 follow-up).
    credentials: true,
    // PUT: /auth/session/active-role (BD-STAND-PUBLIC-01 #1124 — its preflight was rejected).
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
}

export default fp(corsPlugin, { name: 'cors' });
