// /server/test/whatsapp-webhook.test.mjs — hermetic coverage for BD-DOCS-051 WhatsApp
// Business Account webhook seam. DB-independent: the verification handler and the dark POST
// stub are both exercisable without a database connection.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/server.js';

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
