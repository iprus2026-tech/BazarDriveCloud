// /server/test/history-flow.test.mjs — DB-gated end-to-end for R08 (#8 History & Receipt) through
// the real Fastify app + real Postgres. Builds a COMPLETED ride via the live spine (order -> offer ->
// select+bootstrap -> ride-state PATCH to COMPLETED), then reads GET /history for both roles and
// exercises the write-once receipt. SKIPPED without DATABASE_URL; runs in server-ci.
//
// CLEANUP: rides carry append-only ride_events (the PATCH) and a RESTRICT-FK'd receipt, so the rows
// can't be deleted normally — drop them with triggers/FK off (CI superuser), best-effort.
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
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

test('history: complete a ride -> GET /history (both roles) + write-once receipt', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1611${String(process.pid).padStart(7, '0')}`;
  const drv = `+1612${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  const tripIds = [];
  t.after(async () => {
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    if (tripIds.length) {
      await cleanup.query('DELETE FROM receipts WHERE ride_id IN (SELECT id FROM rides WHERE trip_id = ANY($1))', [tripIds]).catch(() => {});
      await cleanup.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    }
    await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
    // orders deleted with triggers/FK back ON so the CASCADE to offers + assignment fires (R08 review).
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, drv]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  // build a COMPLETED ride via the live spine.
  const paxS = await mintSession(app, pax);
  const drvS = await mintSession(app, drv);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const off = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'Иван', price: 800 }, bearer(drvS))).json().offer;
  const sel = (await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: off.driverId }, bearer(paxS))).json();
  const tripId = sel.ride.tripId;
  tripIds.push(tripId);
  // a receipt before completion is refused (post-completion document only).
  assert.equal((await post(app, '/api/v1/history/receipts', { tripId, fare: 800, commission: -120, tip: 0, net: 680 }, bearer(drvS))).statusCode, 409, 'no receipt before the ride is COMPLETED');
  const done = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status: 'COMPLETED' }, bearer(drvS));
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().ride.status, 'COMPLETED');

  // passenger history: one COMPLETED entry; counterparty = the driver; fare = the agreed bid; no receipt.
  const pe = (await get(app, '/api/v1/history', bearer(paxS))).json().items.find((e) => e.tripId === tripId);
  assert.ok(pe, 'passenger sees the completed ride');
  assert.equal(pe.role, 'passenger');
  assert.equal(pe.counterparty.name, 'Иван', 'passenger sees the driver');
  assert.equal(pe.fare, '800 ₽', 'display fare = the agreed bid (R10)');
  assert.equal(pe.receipt, null, 'no receipt yet');

  // driver history: role driver, no receipt yet.
  const de1 = (await get(app, '/api/v1/history', bearer(drvS))).json().items.find((e) => e.tripId === tripId);
  assert.equal(de1.role, 'driver');
  assert.equal(de1.receipt, null);

  // write-once receipt — driver only.
  assert.equal((await post(app, '/api/v1/history/receipts',
    { tripId, fare: 800, commission: -120, tip: 0, net: 680 }, bearer(paxS))).statusCode, 403, 'passenger cannot write the receipt');
  const rec = await post(app, '/api/v1/history/receipts', { tripId, fare: 800, commission: -120, tip: 0, net: 680 }, bearer(drvS));
  assert.equal(rec.statusCode, 201);
  assert.equal(rec.json().receipt.net, 680);
  assert.equal(rec.json().receipt.commission, -120);
  assert.ok(rec.json().receipt.completedAt, 'receipt completed_at derived from the ride');
  // write-once: a second write (different numbers) returns the ORIGINAL receipt, never overwrites.
  const rec2 = await post(app, '/api/v1/history/receipts', { tripId, fare: 999, commission: -1, tip: 0, net: 998 }, bearer(drvS));
  assert.equal(rec2.statusCode, 201);
  assert.equal(rec2.json().receipt.net, 680, 'write-once: original receipt preserved');

  // the driver history entry now carries the receipt; an unknown trip -> 404.
  const de2 = (await get(app, '/api/v1/history', bearer(drvS))).json().items.find((e) => e.tripId === tripId);
  assert.ok(de2.receipt, 'driver entry now carries the receipt');
  assert.equal(de2.receipt.net, 680);
  assert.equal((await post(app, '/api/v1/history/receipts',
    { tripId: 'trip-nope', fare: 1, commission: 0, tip: 0, net: 1 }, bearer(drvS))).statusCode, 404, 'receipt for an unknown trip -> 404');
});
