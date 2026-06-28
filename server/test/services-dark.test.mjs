// /server/test/services-dark.test.mjs — pins the "wired but dark" contract (ADR
// BD-DOCS-041): every #1-#8 service is reachable at its prefix and returns 501
// NOT_IMPLEMENTED; /metrics is a dark skeleton. This is the regression guard that promoting a
// service is a deliberate, visible change (a 501 turning into a real status). NOTE: auth's OTP
// writes were promoted LIVE in R02 (#784) — this file now pins that they VALIDATE (live) and
// no longer 501; the end-to-end OTP flow is covered (DB-gated) by auth-otp-flow.test.mjs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/server.js';
import { SERVICES } from '../src/services/index.js';

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

test('auth OTP write endpoints are LIVE (validate, not 501); session read is live (200)', async () => {
  // R02 promoted these live: a missing/invalid body now hits the live handler's validation
  // (400), not the old 501 skeleton — provable hermetically (the 400 path never touches the
  // DB). The full request->verify->session flow is DB-gated in auth-otp-flow.test.mjs.
  const reqMissing = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: {} });
  assert.equal(reqMissing.statusCode, 400, 'otp/request validates (not 501)');
  assert.equal(reqMissing.json().code, 'VALIDATION');
  const reqBadPhone = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { phone: 'not-a-phone' } });
  assert.equal(reqBadPhone.statusCode, 400, 'otp/request rejects a malformed phone');
  assert.equal(reqBadPhone.json().code, 'INVALID_PHONE');
  const verifyMissing = await app.inject({ method: 'POST', url: '/api/v1/auth/otp/verify', payload: { phone: '+15551234567' } });
  assert.equal(verifyMissing.statusCode, 400, 'otp/verify validates (not 501)');
  assert.equal(verifyMissing.json().code, 'VALIDATION');
  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session' });
  assert.equal(session.statusCode, 200);
});

test('/metrics is a dark skeleton (501)', async () => {
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 501);
  assert.equal(res.json().code, 'NOT_IMPLEMENTED');
});
