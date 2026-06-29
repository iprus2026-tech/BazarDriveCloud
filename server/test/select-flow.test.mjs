// /server/test/select-flow.test.mjs — DB-gated end-to-end for R05 (#3 Matching /select) through
// the real Fastify app + real Postgres. A passenger creates an order, two drivers offer, the
// passenger selects one — the target offer goes 'accepted', the peer 'rejected', an ACCEPTED
// assignment is written, and the order flips CREATED -> ACCEPTED (dropping out of the public feed).
// Plus the guards: non-owner 403, anon 401, self-select 400, unknown driver 404, re-select 409.
// SKIPPED without DATABASE_URL; runs in server-ci. Deleting the order cascades its offers+assignment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

test('select: transactional accept (target accepted, peers rejected, assignment, order ACCEPTED) + guards', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1591${String(process.pid).padStart(7, '0')}`;
  const drvA = `+1592${String(process.pid).padStart(7, '0')}`;
  const drvB = `+1593${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {}); // cascades offers + assignment
    for (const p of [pax, drvA, drvB]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  // passenger creates an order; two drivers offer on it.
  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const drvAS = await mintSession(app, drvA);
  const drvBS = await mintSession(app, drvB);
  const offA = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'A', price: 800 }, bearer(drvAS))).json().offer;
  const offB = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'B', price: 900 }, bearer(drvBS))).json().offer;

  // guards: non-owner 403, anon 401, self-select 400, unknown driver 404.
  assert.equal((await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offA.driverId }, bearer(drvBS))).statusCode, 403, 'non-owner cannot select');
  assert.equal((await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offA.driverId })).statusCode, 401, 'anon cannot select');
  const self = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: paxS.user.userId }, bearer(paxS));
  assert.equal(self.statusCode, 400, 'cannot select self');
  assert.equal(self.json().code, 'CANNOT_SELECT_SELF');
  // unknown driver -> 404, whether the id is malformed (shape-guarded, no pg cast 500) or a
  // valid-but-nonexistent UUID (acceptOffer matches 0 rows).
  assert.equal((await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: 'no-such-driver' }, bearer(paxS))).statusCode, 404, 'malformed driverId -> 404 (not 500)');
  assert.equal((await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: randomUUID() }, bearer(paxS))).statusCode, 404, 'valid-but-nonexistent driver -> 404');

  // owner selects driver A — the transactional accept.
  const selRes = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offA.driverId }, bearer(paxS));
  assert.equal(selRes.statusCode, 200);
  const sel = selRes.json();
  assert.equal(sel.order.status, 'ACCEPTED', 'order flipped to ACCEPTED');
  assert.equal(sel.offer.id, offA.id);
  assert.equal(sel.offer.status, 'accepted', 'target offer accepted');
  assert.equal(sel.assignment.status, 'ACCEPTED');
  assert.equal(sel.assignment.selectedDriverId, offA.driverId, 'assignment pins the chosen driver');

  // peer B is now rejected (owner lists the offers).
  const items = (await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS))).json().items;
  assert.equal(items.find((o) => o.id === offA.id).status, 'accepted');
  assert.equal(items.find((o) => o.id === offB.id).status, 'rejected', 'peer offer rejected');

  // re-select is refused — the order is no longer CREATED.
  assert.equal((await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offB.driverId }, bearer(paxS))).statusCode, 409, 'cannot re-select an accepted order');
  // and no NEW offer can be created on an accepted order (the locked status recheck, Codex #791).
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: order.id }, bearer(drvBS))).statusCode, 409, 'cannot offer on an accepted order');

  // the accepted order drops out of the public CREATED feed.
  const feed = (await get(app, '/api/v1/orders')).json().items;
  assert.equal(feed.find((o) => o.id === order.id), undefined, 'ACCEPTED order is no longer in the feed');
});

test('select serializes concurrent accepts via FOR UPDATE — exactly one wins (R05)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1594${String(process.pid).padStart(7, '0')}`;
  const drvA = `+1595${String(process.pid).padStart(7, '0')}`;
  const drvB = `+1596${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, drvA, drvB]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'A' }, dropoff: { label: 'B' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const offA = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'A' }, bearer(await mintSession(app, drvA)))).json().offer;
  const offB = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'B' }, bearer(await mintSession(app, drvB)))).json().offer;

  // fire two selects (different drivers) concurrently — the FOR UPDATE lock must let exactly one win.
  const [r1, r2] = await Promise.all([
    post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offA.driverId }, bearer(paxS)),
    post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offB.driverId }, bearer(paxS)),
  ]);
  assert.deepEqual([r1.statusCode, r2.statusCode].sort(), [200, 409], 'exactly one accept wins; the other is 409 (no double-accept)');

  // final state: exactly one offer accepted, the peer rejected (one assignment, not two).
  const items = (await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS))).json().items;
  assert.equal(items.filter((o) => o.status === 'accepted').length, 1, 'exactly one offer accepted');
  assert.equal(items.filter((o) => o.status === 'rejected').length, 1, 'the peer is rejected');
});

test('select refuses an offer past its TTL (expired-but-unswept), even though status is still sent (R05)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1597${String(process.pid).padStart(7, '0')}`;
  const drv = `+1598${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, drv]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'A' }, dropoff: { label: 'B' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const off = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'D' }, bearer(await mintSession(app, drv)))).json().offer;

  // force the offer past its TTL while it is still status='sent' (the sweep that flips expired
  // rows is future work) — selecting it must NOT accept a stale offer.
  await cleanup.query("UPDATE offers SET expires_at = now() - interval '1 minute' WHERE legacy_id = $1", [off.id]);
  const sel = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: off.driverId }, bearer(paxS));
  assert.equal(sel.statusCode, 404, 'an expired sent offer is not a live candidate');
  assert.equal(sel.json().code, 'OFFER_NOT_FOUND');
  // the order is untouched (still CREATED, no assignment).
  const o = (await get(app, '/api/v1/orders')).json().items.find((x) => x.id === order.id);
  assert.equal(o.status, 'CREATED', 'order stays open after a failed (expired) select');
});
