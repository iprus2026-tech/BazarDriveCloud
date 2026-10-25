// /server/test/public-exposure.test.mjs — BD-STAND-PUBLIC-01 (#1124), hermetic (no database).
// Pins the public profile and the app-wide limits:
// - OTP answers 403 OTP_DISABLED before any parsing or DB access;
// - X-Forwarded-For is trusted only from loopback peers (the cloudflared → stand proxy →
//   server chain), so req.ip is the client;
// - the 64 KiB body ceiling, with the WhatsApp webhook's own 1 MiB limit;
// - the CORS preflight allows PUT.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { buildApp, fastifyOptions, BODY_LIMIT_BYTES } from '../src/server.js';
import { WHATSAPP_WEBHOOK_BODY_LIMIT } from '../src/routes/webhooks/whatsapp.js';

// A DB on port 1 refuses every connection, so any handler that reached the database would fail.
const baseConfig = {
  nodeEnv: 'test', isProd: false, publicExposure: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: 'postgres://postgres@127.0.0.1:1/none', allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: false },
  session: { ttlSeconds: 86400 },
  receipts: { commissionPercent: 12 },
  drivers: { enrollmentAutoApprove: false },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
  waba: { id: '', phoneNumberId: '', accessToken: '', webhookVerifyToken: '', appSecret: '' },
};
const publicApp = await buildApp({ config: { ...baseConfig, publicExposure: true } });
const devApp = await buildApp({ config: baseConfig });
after(async () => { await publicApp.close(); await devApp.close(); });

// ── OTP is off on a public stand ────────────────────────────────────────────
test('public profile: POST /auth/otp/request answers 403 OTP_DISABLED «Вход через Telegram»', async () => {
  const res = await publicApp.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: '+79990001122' } });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: 'Вход через Telegram', code: 'OTP_DISABLED', retryable: false });
});

test('public profile: the guard runs before body parsing/validation (empty, invalid JSON, oversized)', async () => {
  for (const payload of [{}, { phone: 42 }, '{not json', 'x'.repeat(BODY_LIMIT_BYTES + 10)]) {
    const res = await publicApp.inject({
      method: 'POST', url: '/api/v1/auth/otp/request', payload,
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.statusCode, 403, `payload ${String(payload).slice(0, 20)}`);
    assert.equal(res.json().code, 'OTP_DISABLED');
  }
});

test('public profile: POST /auth/otp/verify answers 403 OTP_DISABLED as well', async () => {
  const res = await publicApp.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: '+79990001122', code: '1234' } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, 'OTP_DISABLED');
});

test('public profile: no DB was involved — the database is unreachable, yet OTP answered 403 (not 5xx)', async () => {
  const ready = await publicApp.inject({ method: 'GET', url: '/api/v1/readyz' });
  assert.equal(ready.statusCode, 503, 'the DB on port 1 is really down');
});

test('development: the OTP routes are not guarded (validation is reached: {} → 400)', async () => {
  const res = await devApp.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: {} });
  assert.equal(res.statusCode, 400);
  assert.notEqual(res.json().code, 'OTP_DISABLED');
});

// ── Client IP behind the tunnel chain ───────────────────────────────────────
async function ipApp(config) {
  const app = Fastify(fastifyOptions(config));
  app.get('/ip', async (req) => ({ ip: req.ip }));
  await app.ready();
  return app;
}
const ipOf = async (app, remoteAddress, xff) => (await app.inject({
  method: 'GET', url: '/ip', remoteAddress, headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
})).json().ip;

test('public profile: req.ip is the X-Forwarded-For client behind the local proxy chain', async () => {
  const app = await ipApp({ ...baseConfig, publicExposure: true });
  try {
    // stand proxy forwards cloudflared's header unchanged
    assert.equal(await ipOf(app, '127.0.0.1', '203.0.113.7'), '203.0.113.7');
    // two local hops: cloudflared → stand proxy (appends its loopback peer) → server
    assert.equal(await ipOf(app, '127.0.0.1', '203.0.113.7, 127.0.0.1'), '203.0.113.7');
    // a client-supplied (spoofed) left-hand entry is ignored: the rightmost untrusted hop wins
    assert.equal(await ipOf(app, '127.0.0.1', '1.2.3.4, 203.0.113.7, 127.0.0.1'), '203.0.113.7');
    // IPv6 loopback peer
    assert.equal(await ipOf(app, '::1', '203.0.113.7, ::1'), '203.0.113.7');
    // no header → the peer itself
    assert.equal(await ipOf(app, '127.0.0.1'), '127.0.0.1');
  } finally { await app.close(); }
});

test('public profile: X-Forwarded-For from a non-loopback peer is ignored (no spoofing from outside)', async () => {
  const app = await ipApp({ ...baseConfig, publicExposure: true });
  try {
    assert.equal(await ipOf(app, '198.51.100.9', '203.0.113.7'), '198.51.100.9');
    assert.equal(await ipOf(app, '10.0.0.5', '127.0.0.1'), '10.0.0.5', 'cannot even claim loopback');
  } finally { await app.close(); }
});

test('development: X-Forwarded-For is not trusted at all (unchanged)', async () => {
  const app = await ipApp(baseConfig);
  try {
    assert.equal(await ipOf(app, '127.0.0.1', '203.0.113.7'), '127.0.0.1');
  } finally { await app.close(); }
});

// ── Body size ───────────────────────────────────────────────────────────────
test('the app-wide body ceiling is 64 KiB: just above → 413, a 60 KB body still reaches validation', async () => {
  assert.equal(BODY_LIMIT_BYTES, 64 * 1024);
  const over = await devApp.inject({
    method: 'POST', url: '/api/v1/chat/messages',
    payload: JSON.stringify({ chatId: 'trip-t1', body: 'я'.repeat(40000) }), // ~80 KB in UTF-8
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(over.statusCode, 413);
  assert.equal(over.json().code, 'FST_ERR_CTP_BODY_TOO_LARGE');
  const under = await devApp.inject({
    method: 'POST', url: '/api/v1/chat/messages',
    payload: JSON.stringify({ chatId: 'trip-t1', body: 'x'.repeat(60000) }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(under.statusCode, 400, 'under the ceiling: parsed, then rejected by the 4000-char schema');
});

test('the largest legitimate chat body (4000 Cyrillic chars) fits well under the ceiling', () => {
  const bytes = Buffer.byteLength(JSON.stringify({ chatId: 'x'.repeat(200), body: 'я'.repeat(4000), senderRole: 'passenger', clientMsgId: 9007199254740991, displayTime: '23:59' }));
  assert.ok(bytes < BODY_LIMIT_BYTES / 3, `${bytes} bytes`);
});

test('POST /webhooks/whatsapp keeps its own 1 MiB limit (Meta sizes that payload)', async () => {
  assert.equal(WHATSAPP_WEBHOOK_BODY_LIMIT, 1024 * 1024);
  const big = await devApp.inject({
    method: 'POST', url: '/api/v1/webhooks/whatsapp',
    payload: JSON.stringify({ entry: [{ blob: 'x'.repeat(200 * 1024) }] }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(big.statusCode, 501, '200 KB passes the route limit and reaches the dark handler');
  const tooBig = await devApp.inject({
    method: 'POST', url: '/api/v1/webhooks/whatsapp',
    payload: JSON.stringify({ blob: 'x'.repeat(WHATSAPP_WEBHOOK_BODY_LIMIT + 1024) }),
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(tooBig.statusCode, 413);
});

// ── CORS ────────────────────────────────────────────────────────────────────
test('CORS preflight allows PUT (PUT /auth/session/active-role) and keeps credentials for the client', async () => {
  const origin = 'https://iprus2026-tech.github.io';
  const app = await buildApp({ config: { ...baseConfig, allowedOrigin: origin } });
  try {
    const res = await app.inject({
      method: 'OPTIONS', url: '/api/v1/auth/session/active-role',
      headers: { origin, 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' },
    });
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers['access-control-allow-origin'], origin);
    assert.match(String(res.headers['access-control-allow-methods']), /\bPUT\b/);
    assert.equal(res.headers['access-control-allow-credentials'], 'true');
  } finally { await app.close(); }
});
