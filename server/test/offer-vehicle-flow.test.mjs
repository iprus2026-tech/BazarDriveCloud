// /server/test/offer-vehicle-flow.test.mjs — #1113 end-to-end through the real Fastify app + real
// Postgres: the driver's offer carries the car (model / colour / plate); the plate is required and
// normalized; the passenger's offers list shows it masked; after /select the ride, its recovered
// read and the history carry the full plate. SKIPPED without DATABASE_URL; runs in server-ci.
// CLEANUP: as history-flow (ride_events are append-only; triggers/FK off, best-effort).
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
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

const FULL = 'А108ОР77';
const MASKED = 'А•••ОР77';

test('offer car: plate required + normalized; masked in the offers list; full on the ride and in history', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1631${String(process.pid).padStart(7, '0')}`;
  const drv = `+1632${String(process.pid).padStart(7, '0')}`;
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
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, drv]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const paxS = await mintSession(app, pax);
  const drvS = await grantDriverRole(cleanup, await mintSession(app, drv));
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const offerCount = async () => (await cleanup.query(
    'SELECT count(*)::int AS n FROM offers o JOIN orders r ON r.id = o.order_id WHERE r.legacy_id = $1', [order.id],
  )).rows[0].n;

  // A passenger-mode session is refused by role first, plate or not (driver authority first).
  const paxOffer = await post(app, '/api/v1/matching/offers', { orderId: order.id }, bearer(paxS));
  assert.deepEqual([paxOffer.statusCode, paxOffer.json().code], [403, 'DRIVER_ROLE_REQUIRED']);

  // No plate (absent, blank) -> 422 VEHICLE_PLATE_REQUIRED, nothing written.
  for (const body of [{ orderId: order.id, price: 700 }, { orderId: order.id, vehiclePlate: '   ' }]) {
    const res = await post(app, '/api/v1/matching/offers', body, bearer(drvS));
    assert.deepEqual([res.statusCode, res.json().code], [422, 'VEHICLE_PLATE_REQUIRED'], JSON.stringify(body));
  }
  // Longer than 20 characters once normalized -> 422 VEHICLE_PLATE_INVALID.
  const long = await post(app, '/api/v1/matching/offers', { orderId: order.id, vehiclePlate: 'A 123 BC 77 EXTRA LONG' }, bearer(drvS));
  assert.deepEqual([long.statusCode, long.json().code], [422, 'VEHICLE_PLATE_INVALID']);
  // The plate is checked before the order: an unknown order without a plate is still 422.
  const unknown = await post(app, '/api/v1/matching/offers', { orderId: 'order-nope' }, bearer(drvS));
  assert.equal(unknown.statusCode, 422);
  assert.equal(await offerCount(), 0, 'no offer was written by a refused request');

  // The driver's offer: the car as separate fields; the plate normalized; the driver sees it in full.
  const created = await post(app, '/api/v1/matching/offers', {
    orderId: order.id, driverName: 'Иван', car: 'Kia Rio · Серый', price: 800,
    vehicleModel: '  Kia   Rio ', vehicleColor: ' Серый ', vehiclePlate: '  a108op77 ',
  }, bearer(drvS));
  assert.equal(created.statusCode, 201);
  assert.deepEqual(created.json().offer.vehicle, { model: 'Kia Rio', color: 'Серый', plate: FULL });
  const stored = (await cleanup.query(
    'SELECT o.vehicle_model, o.vehicle_color, o.vehicle_plate FROM offers o JOIN orders r ON r.id = o.order_id WHERE r.legacy_id = $1', [order.id],
  )).rows[0];
  assert.deepEqual(stored, { vehicle_model: 'Kia Rio', vehicle_color: 'Серый', vehicle_plate: FULL });

  // The passenger's offers list (before selection): masked; the full plate is nowhere in the body.
  const list = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().items[0].vehicle, { model: 'Kia Rio', color: 'Серый', plate: MASKED });
  assert.ok(!list.body.includes('108'), 'the hidden digits never leave the server before selection');

  // /select: the passenger has chosen — the accepted offer and the ride carry the full plate.
  const sel = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: drvS.user.userId }, bearer(paxS));
  assert.equal(sel.statusCode, 200);
  const tripId = sel.json().ride.tripId;
  tripIds.push(tripId);
  assert.deepEqual(sel.json().offer.vehicle, { model: 'Kia Rio', color: 'Серый', plate: FULL });
  assert.deepEqual(sel.json().ride.vehicle, { model: 'Kia Rio', color: 'Серый', plate: FULL });
  const ride = (await cleanup.query('SELECT vehicle_model, vehicle_color, vehicle_plate FROM rides WHERE trip_id = $1', [tripId])).rows[0];
  assert.deepEqual(ride, { vehicle_model: 'Kia Rio', vehicle_color: 'Серый', vehicle_plate: FULL });

  // The recovered ride read (both participants) reprojects the car from the accepted offer.
  for (const s of [paxS, drvS]) {
    const r = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(s));
    assert.equal(r.statusCode, 200);
    assert.deepEqual(r.json().ride.vehicle, { model: 'Kia Rio', color: 'Серый', plate: FULL });
  }
  // After selection the offers list is still the masked list view.
  const after = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().items[0].vehicle.plate, MASKED);

  // Complete the ride: the history rows of both roles carry the car.
  for (const status of ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED']) {
    const done = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status }, bearer(drvS));
    assert.equal(done.statusCode, 200, status);
  }
  for (const s of [paxS, drvS]) {
    const entry = (await get(app, '/api/v1/history', bearer(s))).json().items.find((e) => e.tripId === tripId);
    assert.deepEqual(entry.vehicle, { model: 'Kia Rio', color: 'Серый', plate: FULL });
  }
});
