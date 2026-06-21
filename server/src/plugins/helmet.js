// /server/src/plugins/helmet.js — @fastify/helmet baseline security headers (ADR
// BD-DOCS-041). This origin serves JSON only (no HTML), so the browser CSP that protects
// the PWA lives in public/index.html; here helmet sets the API-safe defaults
// (no-sniff, frame, HSTS, etc.). Registered via fastify-plugin so it applies app-wide.
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';

async function helmetPlugin(app) {
  await app.register(helmet, { global: true });
}

export default fp(helmetPlugin, { name: 'helmet' });
