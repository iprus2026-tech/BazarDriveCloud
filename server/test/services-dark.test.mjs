// /server/test/services-dark.test.mjs — pins the "wired but dark" contract (ADR
// BD-DOCS-041): every #1-#8 service is reachable at its prefix and returns 501
// NOT_IMPLEMENTED; the auth OTP writes are dark while the session read is live; /metrics is
// a dark skeleton. This is the regression guard that promoting a service is a deliberate,
// visible change (a 501 turning into a real status).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/server.js';
import { SERVICES } from '../src/services/index.js';

const config = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: 'postgres://postgres@127.0.0.1:1/none', allowedOrigin: '',
  sessionSecret: '', otp: { ttlSeconds: 300, length: 4 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

const app = await buildApp({ config });
after(() => app.close());

const DARK = SERVICES.map((s) => s.name).filter((n) => n !== 'auth');

test('every #1-#8 service returns 501 NOT_IMPLEMENTED at its prefix', async () => {
  assert.equal(DARK.length, 8, 'eight dark services expected');
  for (const name of DARK) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/${name}` });
    assert.equal(res.statusCode, 501, `${name} root status`);
    assert.equal(res.json().code, 'NOT_IMPLEMENTED', `${name} code`);
  }
});

test('a dark service is dark on a sub-path too', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/orders/anything/deep' });
  assert.equal(res.statusCode, 501);
  assert.equal(res.json().service, 'orders');
});

test('auth OTP write endpoints are dark (501); session read is live (200)', async () => {
  const otpReq = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request' });
  assert.equal(otpReq.statusCode, 501);
  const otpVerify = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify' });
  assert.equal(otpVerify.statusCode, 501);
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  assert.equal(session.statusCode, 200);
});

test('/metrics is a dark skeleton (501)', async () => {
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 501);
  assert.equal(res.json().code, 'NOT_IMPLEMENTED');
});
