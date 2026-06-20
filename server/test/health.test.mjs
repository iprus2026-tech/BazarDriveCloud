// /server/test/health.test.mjs — boot the app via buildApp() (no socket) and exercise the
// operational + auth-seam surface with fastify.inject. DB-independent: the readyz assert is
// tolerant (the unreachable test DB yields 503/down deterministically) so the suite is
// hermetic locally and in CI.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/server.js';

const config = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  // port 1 => immediate ECONNREFUSED, so /readyz fails fast and deterministically.
  databaseUrl: 'postgres://postgres@127.0.0.1:1/none', allowedOrigin: '',
  sessionSecret: '', otp: { ttlSeconds: 300, length: 4 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

const app = await buildApp({ config });
after(() => app.close());

test('GET /api/v1/health is 200 ok and touches no DB', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, 'ok');
});

test('GET /api/v1/readyz returns a deterministic { db } body (503 when DB down)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/readyz' });
  assert.ok([200, 503].includes(res.statusCode), `status ${res.statusCode}`);
  assert.ok(['up', 'down', 'schema-incomplete'].includes(res.json().db));
});

test('GET /api/v1/auth/session is anonymous (user: null) with no token', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().user, null);
});

test('GET /api/v1/auth/session with a token during a DB outage is retryable, not a logout', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/auth/session',
    headers: { authorization: 'Bearer dummy-token' },
  });
  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.retryable, true);
  assert.equal(body.code, 'SESSION_LOOKUP_FAILED');
});

test('unknown route returns the uniform { error, code, retryable } shape', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
  assert.equal(res.statusCode, 404);
  const body = res.json();
  assert.equal(body.code, 'NOT_FOUND');
  assert.equal(body.retryable, false);
  assert.equal(typeof body.error, 'string');
});
