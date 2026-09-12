// /server/test/whatsapp-webhook.test.mjs — hermetic coverage for BD-DOCS-051 WhatsApp
// Business Account webhook seam. DB-independent: the verification handler and the dark POST
// stub are both exercisable without a database connection.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import Fastify from 'fastify';

import { buildApp } from '../src/server.js';
import whatsappWebhookRoutes from '../src/routes/webhooks/whatsapp.js';

const VERIFY_TOKEN = 'test-waba-verify-token-abc123';

const config = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: 'postgres://postgres@127.0.0.1:1/none', allowedOrigin: '',
  sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
  waba: {
    id: 'test-waba-id',
    phoneNumberId: 'test-phone-number-id',
    accessToken: '',
    webhookVerifyToken: VERIFY_TOKEN,
    appSecret: '',
  },
};

const app = await buildApp({ config });
after(() => app.close());

// ── GET verification challenge ─────────────────────────────────────────────

test('GET /api/v1/webhooks/whatsapp — correct token returns challenge', async () => {
  const challenge = 'meta-random-challenge-string';
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': challenge,
    },
  });
  assert.equal(res.statusCode, 200, 'correct token → 200');
  assert.equal(res.body, challenge, 'body is the raw challenge string');
  assert.match(res.headers['content-type'] ?? '', /text\/plain/, 'content-type is text/plain');
});

test('GET /api/v1/webhooks/whatsapp — wrong token returns 403', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': 'wrong-token',
      'hub.challenge': 'some-challenge',
    },
  });
  assert.equal(res.statusCode, 403, 'wrong token → 403');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

// The comparison hashes both sides to a fixed 64-char digest and compares in
// constant time, so token length is not observable: a same-length wrong guess,
// a shorter one and a longer one all fail identically.
test('GET /api/v1/webhooks/whatsapp — wrong token of the same length returns 403', async () => {
  const sameLength = 'x'.repeat(VERIFY_TOKEN.length);
  assert.equal(sameLength.length, VERIFY_TOKEN.length, 'guess matches the configured token length');
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': sameLength, 'hub.challenge': 'c' },
  });
  assert.equal(res.statusCode, 403, 'same-length wrong token → 403');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

test('GET /api/v1/webhooks/whatsapp — wrong token shorter than configured returns 403', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN.slice(0, 5), 'hub.challenge': 'c' },
  });
  assert.equal(res.statusCode, 403, 'shorter wrong token → 403');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

test('GET /api/v1/webhooks/whatsapp — wrong token longer than configured returns 403', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': `${VERIFY_TOKEN}-and-then-some`, 'hub.challenge': 'c' },
  });
  assert.equal(res.statusCode, 403, 'longer wrong token → 403');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

// A repeated `hub.verify_token` query parameter is parsed as an array, not a
// string. It must be rejected *before* hashing — even when the repeated value is
// the correct token — because hashToken() would otherwise fold `[t, t]` through
// String(...) into `"t,t"` and hash that.
test('GET /api/v1/webhooks/whatsapp — repeated hub.verify_token parameter returns 403', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': [VERIFY_TOKEN, VERIFY_TOKEN],
      'hub.challenge': 'c',
    },
  });
  assert.equal(res.statusCode, 403, 'array-valued token (even the correct value, twice) → 403');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

test('GET /api/v1/webhooks/whatsapp — missing token returns 403', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: {
      'hub.mode': 'subscribe',
      'hub.challenge': 'some-challenge',
    },
  });
  assert.equal(res.statusCode, 403, 'absent token → 403');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

test('GET /api/v1/webhooks/whatsapp — non-subscribe mode returns 400', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: {
      'hub.mode': 'unsubscribe',
      'hub.verify_token': VERIFY_TOKEN,
      'hub.challenge': 'some-challenge',
    },
  });
  assert.equal(res.statusCode, 400, 'non-subscribe mode → 400');
  assert.equal(res.json().code, 'INVALID_WEBHOOK_MODE');
});

// ── GET — unconfigured WABA (empty verify token) ───────────────────────────

test('GET /api/v1/webhooks/whatsapp — empty configured token returns 403', async () => {
  const unconfiguredConfig = {
    ...config,
    waba: { ...config.waba, webhookVerifyToken: '' },
  };
  const unconfiguredApp = await buildApp({ config: unconfiguredConfig });
  after(() => unconfiguredApp.close());

  const res = await unconfiguredApp.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: {
      'hub.mode': 'subscribe',
      'hub.verify_token': '',
      'hub.challenge': 'some-challenge',
    },
  });
  assert.equal(res.statusCode, 403, 'empty configured token → 403 even on empty supplied token');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

// hashToken() runs String(...) internally, so an absent `hub.verify_token`
// (`undefined`) must be rejected by the typeof guard *before* hashing — otherwise
// a configured token that happened to be the literal string "undefined" would be
// matched by a request that supplied no token at all.
test('GET /api/v1/webhooks/whatsapp — absent token is not coerced to the string "undefined"', async () => {
  const trapConfig = {
    ...config,
    waba: { ...config.waba, webhookVerifyToken: 'undefined' },
  };
  const trapApp = await buildApp({ config: trapConfig });
  after(() => trapApp.close());

  const res = await trapApp.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: { 'hub.mode': 'subscribe', 'hub.challenge': 'c' }, // no hub.verify_token
  });
  assert.equal(res.statusCode, 403, 'absent token must not satisfy a "undefined" configured token');
  assert.equal(res.json().code, 'WEBHOOK_VERIFICATION_FAILED');
});

// ── Regression: the verify token must never reach request logs ─────────────
// Guards the earlier logging fix ({ logLevel: 'warn' } on the GET route). Uses a
// real pino stream and Fastify's automatic request logging left ENABLED
// (disableRequestLogging defaults to false here — buildApp only disables it for
// nodeEnv === 'test'). No timing assertions.

test('GET /api/v1/webhooks/whatsapp — request logging never emits the verify token', async () => {
  const CANARY = 'DO_NOT_LOG_verify_token_canary_9f3a2b7c'; // configured + the valid supplied value
  const CANARY_WRONG = 'DO_NOT_LOG_verify_token_wrong_guess_00'; // an invalid supplied value

  let logged = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      logged += chunk.toString();
      cb();
    },
  });

  const logApp = Fastify({ logger: { level: 'info', stream: sink } });
  logApp.decorate('config', { waba: { webhookVerifyToken: CANARY } });
  await logApp.register(whatsappWebhookRoutes, { prefix: '/api/v1/webhooks' });
  await logApp.ready();
  after(() => logApp.close());

  // Control — the dark POST route has no logLevel override, so its request log
  // must appear and must serialize req.url. Confirms logging is actually on.
  const control = await logApp.inject({ method: 'POST', url: '/api/v1/webhooks/whatsapp', payload: {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(control.statusCode, 501, 'control POST reaches the dark stub');
  assert.match(logged, /"url":"\/api\/v1\/webhooks\/whatsapp"/, 'automatic request logging is active and serializes req.url');

  logged = '';

  const ok = await logApp.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': CANARY, 'hub.challenge': 'meta-challenge' },
  });
  const bad = await logApp.inject({
    method: 'GET',
    url: '/api/v1/webhooks/whatsapp',
    query: { 'hub.mode': 'subscribe', 'hub.verify_token': CANARY_WRONG, 'hub.challenge': 'meta-challenge' },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(ok.statusCode, 200, 'valid canary token → 200 (success path still exercised)');
  assert.equal(bad.statusCode, 403, 'wrong token → 403 (failure path still exercised)');
  assert.ok(
    !logged.includes('DO_NOT_LOG_verify_token'),
    `neither the configured nor the supplied verify token may appear in logs; captured:\n${logged}`,
  );
});

// ── POST — dark 501 ────────────────────────────────────────────────────────

test('POST /api/v1/webhooks/whatsapp — returns 501 NOT_IMPLEMENTED (dark)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/webhooks/whatsapp',
    payload: { object: 'whatsapp_business_account', entry: [] },
  });
  assert.equal(res.statusCode, 501, 'POST is dark → 501');
  assert.equal(res.json().code, 'NOT_IMPLEMENTED');
  assert.equal(res.json().service, 'whatsapp-webhook');
});
