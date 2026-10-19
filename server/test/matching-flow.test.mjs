// /server/test/matching-flow.test.mjs — DB-gated end-to-end for R04 (#3 Matching offers) through
// the real Fastify app + real Postgres. A passenger creates an order (R03), a driver offers on it
// (idempotent), the passenger lists offers (owner-only), a non-owner is forbidden. (/select went
// live in R05 — its transactional accept is covered by select-flow.test.mjs.) SKIPPED without
// DATABASE_URL; runs in server-ci's app job. Unique per-process phones; cleans up in t.after()
// (deleting the order cascades its offers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { grantDriverRole } from '../test-support/driver-grant.mjs';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const config = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const get = (app, url, headers) => app.inject({ method: 'GET', url, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json(); // { token, user }
}

test('offer create (driver, idempotent) -> owner-only list -> non-owner 403', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1581${String(process.pid).padStart(7, '0')}`;
  const drv = `+1582${String(process.pid).padStart(7, '0')}`;
  const other = `+1583${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {}); // cascades offers
    for (const p of [pax, drv, other]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  // passenger creates an order (R03).
  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders',
    { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);

  // anonymous offer -> 401; a passenger-only session is refused before any order lookup
  // (BD-RIDE-AUTHORITY-01B-A) — for a real and for an unknown order alike.
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: order.id })).statusCode, 401);
  for (const orderId of [order.id, 'order-nope']) {
    const paxOffer = await post(app, '/api/v1/matching/offers', { orderId }, bearer(paxS));
    assert.equal(paxOffer.statusCode, 403, `passenger offer on ${orderId} is refused`);
    assert.equal(paxOffer.json().code, 'DRIVER_ROLE_REQUIRED');
  }

  // a granted driver: unknown order -> 404; the driver cannot offer on their OWN order (Codex #790).
  const drvS = await grantDriverRole(cleanup, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: 'order-nope' }, bearer(drvS))).statusCode, 404);
  const drvOrder = (await post(app, '/api/v1/orders',
    { pickup: { label: 'Гараж' }, dropoff: { label: 'Вокзал' } }, bearer(drvS))).json().order;
  orderIds.push(drvOrder.id);
  const selfOffer = await post(app, '/api/v1/matching/offers', { orderId: drvOrder.id }, bearer(drvS));
  assert.equal(selfOffer.statusCode, 403, 'self-offer is forbidden');
  assert.equal(selfOffer.json().code, 'CANNOT_OFFER_OWN_ORDER');

  // driver offers on the passenger's order.
  const off1res = await post(app, '/api/v1/matching/offers',
    { orderId: order.id, driverName: 'Иван', car: 'Kia Rio', rating: '4,9', etaMin: 5, price: 850, message: 'еду' }, bearer(drvS));
  assert.equal(off1res.statusCode, 201);
  const off1 = off1res.json().offer;
  assert.match(off1.id, /^offer_/, 'composite-key offer id');
  assert.equal(off1.status, 'sent');
  assert.equal(off1.orderId, order.id);
  assert.equal(off1.driverId, drvS.user.userId, 'offer is owned by the authenticated driver');
  assert.equal(off1.price, 850);

  // idempotent: re-POST returns the SAME offer (one per order+driver), still sent.
  const off2 = (await post(app, '/api/v1/matching/offers', { orderId: order.id, price: 999 }, bearer(drvS))).json().offer;
  assert.equal(off2.id, off1.id, 'same (order,driver) => same offer');
  assert.equal(off2.status, 'sent');

  // owner lists offers (owner-only) -> exactly one.
  const listRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(listRes.statusCode, 200);
  const items = listRes.json().items;
  assert.equal(items.length, 1, 'one offer for the order');
  assert.equal(items[0].id, off1.id);

  // a DIFFERENT authenticated user cannot list another passenger's offers.
  const otherS = await mintSession(app, other);
  assert.equal((await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(otherS))).statusCode, 403);
  // anonymous list -> 401.
  assert.equal((await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`)).statusCode, 401);

  // /select went LIVE in R05 — an empty body now validates (400), not 501; the full transactional
  // accept is covered by select-flow.test.mjs.
  assert.equal((await post(app, '/api/v1/matching/select', {}, bearer(paxS))).statusCode, 400);
});

// BD-RIDE-AUTHORITY-01B-A (docs/ride-state-receipt-authority-contract.md §2): the offer route reads
// the CURRENT grant on every request, so the session role alone is never enough.
test('offer role gate: only a granted, active, verified driver may offer', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const tag = String(process.pid).padStart(7, '0');
  const pax = `+1584${tag}`;
  const dual = `+1585${tag}`;
  const drv = `+1586${tag}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, dual, drv]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const offer = (s, orderId) => post(app, '/api/v1/matching/offers', { orderId, price: 700 }, bearer(s));
  const offerCount = async (legacyId) => (await cleanup.query(
    'SELECT count(*)::int AS n FROM offers o JOIN orders r ON r.id = o.order_id WHERE r.legacy_id = $1', [legacyId],
  )).rows[0].n;
  const expectRefused = async (res, label) => {
    assert.equal(res.statusCode, 403, label);
    assert.deepEqual(res.json(),
      { error: 'a granted, active driver role is required', code: 'DRIVER_ROLE_REQUIRED', retryable: false }, label);
  };

  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders',
    { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);

  // a dual-role account whose session is active as passenger is refused.
  const dualS = await grantDriverRole(cleanup, await mintSession(app, dual), { activeRole: 'passenger' });
  await expectRefused(await offer(dualS, order.id), 'dual-role session active as passenger');

  // a granted, active driver offers.
  const drvS = await grantDriverRole(cleanup, await mintSession(app, drv));
  const accepted = await offer(drvS, order.id);
  assert.equal(accepted.statusCode, 201);
  assert.equal(accepted.json().offer.driverId, drvS.user.userId);

  // the grant is revoked after the session was issued: the next request is refused.
  await cleanup.query("UPDATE users SET roles = ARRAY['passenger']::text[], active_role = 'passenger' WHERE id = $1", [drvS.user.userId]);
  await expectRefused(await offer(drvS, order.id), 'revoked grant');

  // the grant is restored but the account phone is no longer verified: refused.
  await cleanup.query(
    "UPDATE users SET roles = ARRAY['passenger','driver']::text[], active_role = 'driver', phone_verified = false WHERE id = $1",
    [drvS.user.userId],
  );
  await expectRefused(await offer(drvS, order.id), 'unverified phone');

  // refusals write nothing: the only offer is the one the granted driver made.
  assert.equal(await offerCount(order.id), 1);
});
