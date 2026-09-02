// Hermetic route guard for BD-DRIVER-DOCUMENT-COMPLIANCE-01B (#955).
// Proves the one narrow Safety read is live without requiring PostgreSQL, while
// the rest of service #7 remains the explicit dark skeleton.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/server.js';

const config = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: 'postgres://postgres@127.0.0.1:1/none', allowedOrigin: '',
  sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

const app = await buildApp({ config });
after(() => app.close());

test('driver compliance GET is live and session-gated, not a 501 skeleton', async () => {
  const anonymous = await app.inject({
    method: 'GET',
    url: '/api/v1/safety/driver/compliance',
  });
  assert.equal(anonymous.statusCode, 401);
  assert.deepEqual(anonymous.json(), {
    error: 'authentication required',
    code: 'UNAUTHENTICATED',
    retryable: false,
  });

  // A presented token whose lookup cannot reach PostgreSQL is retryable 503,
  // never anonymous, logout-shaped, or a misleading empty/missing projection.
  const lookupFailure = await app.inject({
    method: 'GET',
    url: '/api/v1/safety/driver/compliance',
    headers: { authorization: 'Bearer invalid-for-unreachable-db' },
  });
  assert.equal(lookupFailure.statusCode, 503);
  assert.deepEqual(lookupFailure.json(), {
    error: 'session lookup failed',
    code: 'SESSION_LOOKUP_FAILED',
    retryable: true,
  });
});

test('the bare Safety service and unrelated subpaths remain dark', async () => {
  const root = await app.inject({ method: 'GET', url: '/api/v1/safety' });
  assert.equal(root.statusCode, 501);
  assert.equal(root.json().code, 'NOT_IMPLEMENTED');
  assert.equal(root.json().service, 'safety');

  const moderation = await app.inject({
    method: 'POST',
    url: '/api/v1/safety/moderation/cases',
    payload: {},
  });
  assert.equal(moderation.statusCode, 501);
  assert.equal(moderation.json().code, 'NOT_IMPLEMENTED');
  assert.equal(moderation.json().service, 'safety');
});
