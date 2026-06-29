// /server/test/services-dark.test.mjs — pins the "wired but dark" contract (ADR
// BD-DOCS-041): every #1-#8 service is reachable at its prefix and returns 501
// NOT_IMPLEMENTED; /metrics is a dark skeleton. This is the regression guard that promoting a
// service is a deliberate, visible change (a 501 turning into a real status). NOTE: auth's OTP
// writes were promoted LIVE in R02, and orders #1 in R03 (#784) — this file now pins that they
// VALIDATE (live) and no longer 501; their end-to-end flows are DB-gated (auth-otp-flow,
// orders-flow). The remaining #2-#8 services stay dark 501.
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

// auth (R02), orders #1 (R03) and matching #3 (R04) are LIVE; the rest stay dark 501.
const DARK = SERVICES.map((s) => s.name).filter((n) => n !== 'auth' && n !== 'orders' && n !== 'matching');

test('every still-dark service returns 501 NOT_IMPLEMENTED at its prefix', async () => {
  assert.equal(DARK.length, 6, 'six dark services expected (orders #1, matching #3 went live)');
  for (const name of DARK) {
    const res = await app.inject({ method: 'GET', url: `/api/v1/${name}` });
    assert.equal(res.statusCode, 501, `${name} root status`);
    assert.equal(res.json().code, 'NOT_IMPLEMENTED', `${name} code`);
  }
});

test('a dark service is dark on a sub-path too', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/v1/availability/anything/deep' });
  assert.equal(res.statusCode, 501);
  assert.equal(res.json().service, 'availability');
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

test('orders #1 is LIVE (validates, auth-gated, honors authError; not 501)', async () => {
  // R03 promoted orders live — provable hermetically (no reachable DB here); the old dark skeleton
  // would have 501'd every case. The create+list flow is DB-gated (orders-flow).
  // (a) invalid/empty body hits the live schema (400 VALIDATION). Empty {} is rejected because
  //     pickup+dropoff are required (Codex #789 — no null-route orders).
  const bad = await app.inject({ method: 'POST', url: '/api/v1/orders', payload: { type: 'bogus' } });
  assert.equal(bad.statusCode, 400, 'POST /orders validates (not 501)');
  assert.equal(bad.json().code, 'VALIDATION');
  const empty = await app.inject({ method: 'POST', url: '/api/v1/orders', payload: {} });
  assert.equal(empty.statusCode, 400, 'empty body rejected (pickup+dropoff required)');
  // (b) a VALID body with NO token hits the live auth gate (401), pre-DB.
  const noAuth = await app.inject({ method: 'POST', url: '/api/v1/orders',
    payload: { pickup: { label: 'A' }, dropoff: { label: 'B' } } });
  assert.equal(noAuth.statusCode, 401, 'POST /orders requires a session (not 501)');
  assert.equal(noAuth.json().code, 'UNAUTHENTICATED');
  // (c) a token whose lookup fails (DB unreachable here) is a retryable 503 on the public GET too,
  //     never a misleading anonymous feed (Codex #789).
  const ge = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: { authorization: 'Bearer x' } });
  assert.equal(ge.statusCode, 503, 'GET /orders surfaces authError as 503');
  assert.equal(ge.json().code, 'SESSION_LOOKUP_FAILED');
});

test('matching #3 offers + select are LIVE (validate + auth-gated, not 501)', async () => {
  // R04 promoted offer create/list live; R05 promoted /select live. Hermetic (no DB):
  const noField = await app.inject({ method: 'POST', url: '/api/v1/matching/offers', payload: {} });
  assert.equal(noField.statusCode, 400, 'POST /matching/offers validates (orderId required, not 501)');
  assert.equal(noField.json().code, 'VALIDATION');
  const noAuth = await app.inject({ method: 'POST', url: '/api/v1/matching/offers', payload: { orderId: 'order-x' } });
  assert.equal(noAuth.statusCode, 401, 'offer create requires a session');
  assert.equal(noAuth.json().code, 'UNAUTHENTICATED');
  const listNoAuth = await app.inject({ method: 'GET', url: '/api/v1/matching/offers?orderId=order-x' });
  assert.equal(listNoAuth.statusCode, 401, 'owner-only list requires a session');
  // /select is LIVE in R05: empty body -> 400 VALIDATION (orderId+driverId required); valid body
  // with no token -> 401. The transactional accept is DB-gated (select-flow).
  const selectEmpty = await app.inject({ method: 'POST', url: '/api/v1/matching/select', payload: {} });
  assert.equal(selectEmpty.statusCode, 400, '/select validates (not 501)');
  assert.equal(selectEmpty.json().code, 'VALIDATION');
  const selectNoAuth = await app.inject({ method: 'POST', url: '/api/v1/matching/select', payload: { orderId: 'order-x', driverId: 'd-x' } });
  assert.equal(selectNoAuth.statusCode, 401, '/select requires a session');
  assert.equal(selectNoAuth.json().code, 'UNAUTHENTICATED');
});

test('/metrics is a dark skeleton (501)', async () => {
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 501);
  assert.equal(res.json().code, 'NOT_IMPLEMENTED');
});
