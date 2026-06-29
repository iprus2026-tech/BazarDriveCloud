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

// auth (R02), orders (R03), matching (R04/R05), ride-state (R06), history #8 (R08) are LIVE; rest dark.
const LIVE = new Set(['auth', 'orders', 'matching', 'ride-state', 'history']);
const DARK = SERVICES.map((s) => s.name).filter((n) => !LIVE.has(n));

test('every still-dark service returns 501 NOT_IMPLEMENTED at its prefix', async () => {
  assert.equal(DARK.length, 4, 'four dark services expected (history #8 went live in R08)');
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

test('ride-state #5 is LIVE (validates + auth-gated + authError; not 501)', async () => {
  // R06 promoted the ride-state chokepoint live. Hermetic (no reachable DB here):
  // PATCH with a missing status -> 400 VALIDATION (live schema, not 501).
  const bad = await app.inject({ method: 'PATCH', url: '/api/v1/ride-state/rides/trip-x/status', payload: {} });
  assert.equal(bad.statusCode, 400, 'PATCH validates (status required, not 501)');
  assert.equal(bad.json().code, 'VALIDATION');
  // valid body, no token -> 401 (auth gate, pre-DB).
  const noAuth = await app.inject({ method: 'PATCH', url: '/api/v1/ride-state/rides/trip-x/status', payload: { status: 'IN_PROGRESS' } });
  assert.equal(noAuth.statusCode, 401, 'PATCH requires a session');
  assert.equal(noAuth.json().code, 'UNAUTHENTICATED');
  const getNoAuth = await app.inject({ method: 'GET', url: '/api/v1/ride-state/rides/trip-x' });
  assert.equal(getNoAuth.statusCode, 401, 'GET snapshot requires a session');
  // a token whose lookup fails (DB unreachable here) -> retryable 503, not a 200/500.
  const getErr = await app.inject({ method: 'GET', url: '/api/v1/ride-state/rides/trip-x', headers: { authorization: 'Bearer x' } });
  assert.equal(getErr.statusCode, 503, 'GET surfaces authError as 503');
  assert.equal(getErr.json().code, 'SESSION_LOOKUP_FAILED');
});

test('history #8 is LIVE (validates + auth-gated, not 501)', async () => {
  // R08 promoted #8 live. Hermetic (no DB): GET /history with no token -> 401 (auth, pre-DB); a
  // receipt POST with a missing body -> 400 VALIDATION; a valid receipt body with no token -> 401.
  const getNoAuth = await app.inject({ method: 'GET', url: '/api/v1/history' });
  assert.equal(getNoAuth.statusCode, 401, 'GET /history requires a session (not 501)');
  assert.equal(getNoAuth.json().code, 'UNAUTHENTICATED');
  const bad = await app.inject({ method: 'POST', url: '/api/v1/history/receipts', payload: {} });
  assert.equal(bad.statusCode, 400, 'POST /receipts validates (not 501)');
  assert.equal(bad.json().code, 'VALIDATION');
  const noAuth = await app.inject({ method: 'POST', url: '/api/v1/history/receipts',
    payload: { tripId: 'trip-x', fare: 800, commission: -100, tip: 0, net: 700 } });
  assert.equal(noAuth.statusCode, 401, 'POST /receipts requires a session');
  assert.equal(noAuth.json().code, 'UNAUTHENTICATED');
});

test('realtime poll is LIVE (validates + auth-gated; #9 read seam)', async () => {
  // R09 lit the realtime read seam (a participant-gated DB-cursor poll). Hermetic (no DB):
  const noTrip = await app.inject({ method: 'GET', url: '/api/v1/realtime/poll' });
  assert.equal(noTrip.statusCode, 400, 'tripId is required');
  assert.equal(noTrip.json().code, 'VALIDATION');
  const badSince = await app.inject({ method: 'GET', url: '/api/v1/realtime/poll?tripId=trip-x&since=not-a-date' });
  assert.equal(badSince.statusCode, 400, 'a malformed since cursor is a 400, not a timestamptz 500');
  const noAuth = await app.inject({ method: 'GET', url: '/api/v1/realtime/poll?tripId=trip-x' });
  assert.equal(noAuth.statusCode, 401, 'poll requires a session');
  assert.equal(noAuth.json().code, 'UNAUTHENTICATED');
});

test('chat #784 R07 is LIVE (validates; intentionally NOT 401-gated)', async () => {
  // R07 chat is its own route group (not a registry service) and is intentionally auth-free. Hermetic
  // (no reachable DB): the validation paths prove the routes are live (not 501). The actual
  // post/get/dedup + the auth-free behaviour are DB-gated (chat-flow).
  const noBody = await app.inject({ method: 'POST', url: '/api/v1/chat/messages', payload: {} });
  assert.equal(noBody.statusCode, 400, 'POST /chat/messages validates (chatId+body required, not 501)');
  assert.equal(noBody.json().code, 'VALIDATION');
  const noChatId = await app.inject({ method: 'GET', url: '/api/v1/chat/messages' });
  assert.equal(noChatId.statusCode, 400, 'GET /chat/messages requires chatId (not 501)');
  assert.equal(noChatId.json().code, 'VALIDATION');
});

test('/metrics is a dark skeleton (501)', async () => {
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  assert.equal(res.statusCode, 501);
  assert.equal(res.json().code, 'NOT_IMPLEMENTED');
});
