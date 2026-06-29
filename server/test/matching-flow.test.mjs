// /server/test/matching-flow.test.mjs — DB-gated end-to-end for R04 (#3 Matching offers) through
// the real Fastify app + real Postgres. A passenger creates an order (R03), a driver offers on it
// (idempotent), the passenger lists offers (owner-only), a non-owner is forbidden, and /select is
// still 501. SKIPPED without DATABASE_URL; runs in server-ci's app job. Unique per-process phones;
// cleans up in t.after() (deleting the order cascades its offers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';

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

test('offer create (driver, idempotent) -> owner-only list -> non-owner 403 -> select 501', { skip: SKIP }, async (t) => {
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

  // unknown order -> 404; anonymous offer -> 401.
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: 'order-nope' }, bearer(paxS))).statusCode, 404);
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: order.id })).statusCode, 401);
  // a passenger cannot offer on their OWN order (Codex #790) — no self-candidate is created.
  const selfOffer = await post(app, '/api/v1/matching/offers', { orderId: order.id }, bearer(paxS));
  assert.equal(selfOffer.statusCode, 403, 'self-offer is forbidden');
  assert.equal(selfOffer.json().code, 'CANNOT_OFFER_OWN_ORDER');

  // driver offers on the order.
  const drvS = await mintSession(app, drv);
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

  // /select is still dark (R05).
  assert.equal((await post(app, '/api/v1/matching/select', {}, bearer(paxS))).statusCode, 501);
});
