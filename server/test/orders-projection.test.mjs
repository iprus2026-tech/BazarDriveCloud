// /server/test/orders-projection.test.mjs — BD-ORDERS-PUBLIC-PROJECTION-01 (#1125, owner's decisions
// R1–R6) through the real Fastify app + real Postgres:
//   - R1: GET /orders without a session -> 401;
//   - R2–R3: the owner sees the exact address and the comment; another passenger and a driver who was
//     not selected see the street without the house (or no address when it cannot be parsed), no
//     coordinates, no comment; the selected driver gets the exact address through the ride;
//   - R5: the strict point schema accepts the shapes the PWA sends and rejects anything else;
//   - R6: at most 5 open orders per passenger (409 ORDER_LIMIT), also under concurrency.
// SKIPPED without DATABASE_URL; runs in server-ci. Unique per-process phones; cleanup in t.after().
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

const post = (app, url, payload, s) => app.inject({ method: 'POST', url, payload, headers: s ? { authorization: `Bearer ${s.token}` } : {} });
const get = (app, url, s) => app.inject({ method: 'GET', url, headers: s ? { authorization: `Bearer ${s.token}` } : {} });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

const tag = String(process.pid).padStart(7, '0');
const phone = (group, i) => `+185${group}${tag}${i}`;

async function fixture(t, phones) {
  const app = await buildApp({ config });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  t.after(async () => {
    for (const p of phones) {
      const users = await db.query('SELECT id FROM users WHERE phone = $1', [p]).catch(() => ({ rows: [] }));
      for (const { id } of users.rows) {
        const orders = await db.query('SELECT id, legacy_id FROM orders WHERE passenger_id = $1', [id]).catch(() => ({ rows: [] }));
        const trips = orders.rows.map((o) => `trip_${o.legacy_id}`);
        await db.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [trips]).catch(() => {});
        await db.query('DELETE FROM rides WHERE trip_id = ANY($1)', [trips]).catch(() => {});
        await db.query('DELETE FROM orders WHERE passenger_id = $1', [id]).catch(() => {});
      }
      await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await db.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await db.end();
    await app.close();
  });
  return { app, db };
}

const EXACT = 'ул. Ленина, 10, кв. 5';
const DEVICE_POINT = { id: null, label: EXACT, lng: 37.6173, lat: 55.7558, provenance: 'device_fix', capturedAt: 1761400000000, accuracyMeters: 12 };

test('orders feed: 401 without a session (R1)', { skip: SKIP }, async (t) => {
  const { app } = await fixture(t, []);
  const res = await get(app, '/api/v1/orders');
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'UNAUTHENTICATED');
});

test('orders feed: the owner sees it exactly; others see the street without the house; the selected driver gets it through the ride (R2-R3)', { skip: SKIP }, async (t) => {
  const { app, db } = await fixture(t, [phone(0, 0), phone(0, 1), phone(0, 2), phone(0, 3)]);
  const owner = await mintSession(app, phone(0, 0));
  const otherPassenger = await mintSession(app, phone(0, 1));
  const selected = await grantDriverRole(db, await mintSession(app, phone(0, 2)));
  const notSelected = await grantDriverRole(db, await mintSession(app, phone(0, 3)));

  const created = await post(app, '/api/v1/orders', {
    pickup: DEVICE_POINT, dropoff: { id: null, label: 'возле дома 5' }, comment: 'Позвоните у подъезда',
  }, owner);
  assert.equal(created.statusCode, 201, created.body);
  const orderId = created.json().order.id;
  const find = async (s) => (await get(app, '/api/v1/orders', s)).json().items.find((o) => o.id === orderId);

  const mine = await find(owner);
  assert.equal(mine.projection, 'owner');
  assert.deepEqual(mine.pickup, DEVICE_POINT);
  assert.equal(mine.comment, 'Позвоните у подъезда');

  for (const s of [otherPassenger, notSelected]) {
    const seen = await find(s);
    assert.ok(seen, 'the order is listed');
    assert.equal(seen.projection, 'public');
    assert.deepEqual(seen.pickup, { label: 'ул. Ленина' }, 'the street, no house, no coordinates');
    assert.equal(seen.dropoff, null, 'an address that cannot be parsed is not shown at all');
    assert.equal(seen.comment, '');
    const raw = JSON.stringify(seen);
    for (const leak of ['кв. 5', '37.6173', '55.7558', 'device_fix', 'подъезд', 'дома 5']) {
      assert.ok(!raw.includes(leak), `no «${leak}» for a non-owner`);
    }
  }

  // The selected driver: the order leaves the feed, and the ride carries the exact address.
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: 'А 123 ВС 77', orderId, price: 700 }, selected)).statusCode, 201);
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: 'В 456 ОР 77', orderId, price: 650 }, notSelected)).statusCode, 201);
  assert.equal((await post(app, '/api/v1/matching/select', { orderId, driverId: selected.user.userId }, owner)).statusCode, 200);
  assert.equal(await find(otherPassenger), undefined, 'an accepted order is no longer in the feed');
  const ride = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(`trip_${orderId}`)}`, selected);
  assert.equal(ride.statusCode, 200);
  assert.ok(ride.body.includes(EXACT), 'the selected driver gets the exact address through the ride');
  const outsider = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(`trip_${orderId}`)}`, notSelected);
  assert.ok(!outsider.body.includes(EXACT), 'a driver who was not selected does not');
});

test('orders: the strict point schema accepts what the PWA sends and rejects the rest (R5)', { skip: SKIP }, async (t) => {
  const { app } = await fixture(t, [phone(1, 0)]);
  const p = await mintSession(app, phone(1, 0));
  const create = (pickup) => post(app, '/api/v1/orders', { pickup, dropoff: { id: null, label: 'Центр' } }, p);
  // Shapes the current client sends (passenger_order_utils / driver_map), and the legacy route-picker one.
  for (const ok of [
    { id: null, label: 'Дом' },
    DEVICE_POINT,
    { id: 'p1', label: 'Дом', lng: 37.6, lat: 55.7, provenance: 'mock_hash' },
    { id: 'p2', label: 'Дом', hint: 'Москва · 28 км', source: 'search', coords: { lng: 37.6, lat: 55.7, provenance: 'mock_hash' } },
  ]) {
    const res = await create(ok);
    assert.equal(res.statusCode, 201, `${JSON.stringify(ok)}: ${res.body}`);
    assert.equal((await post(app, `/api/v1/orders/${encodeURIComponent(res.json().order.id)}/cancel`, undefined, p)).statusCode, 200);
  }
  for (const bad of [
    { label: 'Дом', extra: 'x' },
    { label: 'Дом', coords: [37.6, 55.7] },
    { label: 'Дом', coords: { lng: 37.6, lat: 55.7, note: 'x' } },
    { label: 'Дом', lat: 91 },
    { label: 'Дом', provenance: 'gps' },
    { label: 'Дом', accuracyMeters: -1 },
    { label: 'я'.repeat(201) },
    { label: '' },
  ]) {
    const res = await create(bad);
    assert.equal(res.statusCode, 400, JSON.stringify(bad).slice(0, 80));
  }
});

test('orders: at most 5 open orders per passenger, also under concurrency (R6)', { skip: SKIP }, async (t) => {
  const { app } = await fixture(t, [phone(2, 0), phone(2, 1)]);
  const p = await mintSession(app, phone(2, 0));
  const create = (s, i) => post(app, '/api/v1/orders', { pickup: { label: `Дом ${i}` }, dropoff: { label: 'Центр' } }, s);
  const ids = [];
  for (let i = 0; i < 5; i += 1) {
    const res = await create(p, i);
    assert.equal(res.statusCode, 201);
    ids.push(res.json().order.id);
  }
  const sixth = await create(p, 5);
  assert.equal(sixth.statusCode, 409);
  assert.equal(sixth.json().code, 'ORDER_LIMIT');
  // A canceled order frees a place.
  assert.equal((await post(app, `/api/v1/orders/${encodeURIComponent(ids[0])}/cancel`, undefined, p)).statusCode, 200);
  assert.equal((await create(p, 6)).statusCode, 201);

  const q = await mintSession(app, phone(2, 1));
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => create(q, i)));
  assert.equal(burst.filter((r) => r.statusCode === 201).length, 5, 'exactly the cap is created');
  assert.equal(burst.filter((r) => r.statusCode === 409).length, 3);
});
