// /server/test/public-places.test.mjs — BD-ORDERS-PUBLIC-PLACES-01 (#1160): the public places catalog.
//   - hermetic: catalog integrity, the ODbL attribution, GET /api/v1/places (no session, no DB);
//   - DB-gated: a point's placeId is accepted, an unknown one is 400 UNKNOWN_PLACE, and other people
//     see a catalog point by the catalog name and pickup point, never by the client's text.
// DB-gated tests are SKIPPED without DATABASE_URL; server-ci runs them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { PUBLIC_PLACES, findPublicPlace, PLACE_ID_PATTERN } from '../src/domain/public-places.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';
const NO_DB = 'postgres://postgres@127.0.0.1:1/none';
const config = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL || NO_DB, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

test('catalog: unique ids in the pattern, a name, a kind, a pickup point and an OSM building', () => {
  const ids = new Set();
  const pattern = new RegExp(PLACE_ID_PATTERN);
  for (const p of PUBLIC_PLACES) {
    assert.match(p.id, pattern, p.id);
    assert.equal(ids.has(p.id), false, `duplicate ${p.id}`);
    ids.add(p.id);
    assert.ok(p.name.trim().length > 0, p.id);
    assert.ok(['airport', 'railway_station'].includes(p.kind), p.id);
    // Moscow and the Moscow region.
    for (const point of [p.pickup, p.building]) {
      assert.ok(point.lat > 55.1 && point.lat < 56.3 && point.lng > 36.8 && point.lng < 38.5, `${p.id} in the region`);
    }
    assert.match(p.building.osm, /^(node|way|relation)\/\d+$/, p.id);
    assert.equal(typeof p.pickupConfirmed, 'boolean');
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.pickup) && Object.isFrozen(p.building));
  }
  assert.ok(Object.isFrozen(PUBLIC_PLACES));
});

test('catalog: the owner-confirmed first set — SVO B, C, D and the Moscow stations; no unconfirmed airport', () => {
  const airports = PUBLIC_PLACES.filter((p) => p.kind === 'airport').map((p) => p.id);
  assert.deepEqual(airports, ['svo-b', 'svo-c', 'svo-d']);
  assert.equal(PUBLIC_PLACES.filter((p) => p.kind === 'railway_station').length, 10);
  assert.ok(PUBLIC_PLACES.every((p) => p.pickupConfirmed === true), 'every listed pickup point is confirmed');
  for (const id of ['vko-a', 'dme', 'zia']) assert.equal(findPublicPlace(id), null);
  for (const id of [undefined, null, 5, {}, '', 'SVO-B']) assert.equal(findPublicPlace(id), null);
});

test('catalog: the source and the README carry the ODbL attribution', () => {
  const src = fs.readFileSync(new URL('../src/domain/public-places.js', import.meta.url), 'utf8');
  assert.match(src, /© OpenStreetMap contributors, ODbL/);
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /© OpenStreetMap contributors, ODbL/);
});

test('GET /api/v1/places: the catalog pickup points, public, no DB', async (t) => {
  const app = await buildApp({ config: { ...config, databaseUrl: NO_DB } });
  t.after(() => app.close());
  const res = await app.inject({ method: 'GET', url: '/api/v1/places' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.attribution, '© OpenStreetMap contributors, ODbL');
  assert.deepEqual(body.items.map((i) => i.id), PUBLIC_PLACES.map((p) => p.id));
  const svoB = body.items.find((i) => i.id === 'svo-b');
  assert.deepEqual(svoB, {
    id: 'svo-b', name: 'Аэропорт Шереметьево, терминал B', kind: 'airport', lng: 37.416908, lat: 55.980107, pickupConfirmed: true,
  });
  assert.equal(JSON.stringify(body).includes('relation/'), false, 'the OSM building ids stay server-side');
});

const post = (app, url, payload, s) => app.inject({ method: 'POST', url, payload, headers: s ? { authorization: `Bearer ${s.token}` } : {} });
const get = (app, url, s) => app.inject({ method: 'GET', url, headers: s ? { authorization: `Bearer ${s.token}` } : {} });
async function mintSession(app, p) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone: p })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone: p, code })).json();
}
const tag = String(process.pid).padStart(7, '0');
const phone = (i) => `+186${tag}${i}`;

test('orders: placeId is accepted, an unknown one is 400, and others see the catalog place', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const phones = [phone(0), phone(1)];
  t.after(async () => {
    for (const p of phones) {
      const users = await db.query('SELECT id FROM users WHERE phone = $1', [p]).catch(() => ({ rows: [] }));
      for (const { id } of users.rows) await db.query('DELETE FROM orders WHERE passenger_id = $1', [id]).catch(() => {});
      await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await db.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await db.end();
    await app.close();
  });
  const owner = await mintSession(app, phones[0]);
  const other = await mintSession(app, phones[1]);

  // The owner keeps the point as sent; everyone else gets the catalog name and pickup point.
  const pickup = { id: 'vnukovo-a', label: 'Шереметьево B, Иванов, у выхода 5', placeId: 'svo-b', lng: 37.4, lat: 55.98, provenance: 'user_pin' };
  const created = await post(app, '/api/v1/orders', {
    pickup, dropoff: { id: null, label: 'ул. Ленина, 10, кв. 5', placeId: 'station-kazansky' },
  }, owner);
  assert.equal(created.statusCode, 201, created.body);
  assert.deepEqual(created.json().order.pickup, pickup, 'the owner sees the point as sent');
  const id = created.json().order.id;

  const seen = (await get(app, '/api/v1/orders', other)).json().items.find((o) => o.id === id);
  assert.deepEqual(seen.pickup, {
    label: 'Аэропорт Шереметьево, терминал B', placeId: 'svo-b', lng: 37.416908, lat: 55.980107, provenance: 'geocode_point',
  });
  assert.deepEqual(seen.dropoff, {
    label: 'Казанский вокзал', placeId: 'station-kazansky', lng: 37.656435, lat: 55.77353, provenance: 'geocode_point',
  });
  assert.equal(JSON.stringify(seen).includes('Иванов'), false, 'never the client text');
  assert.equal(JSON.stringify(seen).includes('кв. 5'), false);

  // Without placeId the S4 street whitelist still applies.
  const plain = await post(app, '/api/v1/orders', {
    pickup: { id: null, label: 'ул. Ленина, 10' }, dropoff: { id: null, label: 'Казанский вокзал' },
  }, owner);
  const plainSeen = (await get(app, '/api/v1/orders', other)).json().items.find((o) => o.id === plain.json().order.id);
  assert.deepEqual(plainSeen.pickup, { label: 'ул. Ленина' });
  assert.equal(plainSeen.dropoff, null, 'a typed station name without placeId is not a recognized street');

  for (const bad of ['svo-z', 'vko-a', 'zz']) {
    const res = await post(app, '/api/v1/orders', { pickup: { label: 'x', placeId: bad }, dropoff: { label: 'y' } }, owner);
    assert.equal(res.statusCode, 400, bad);
    assert.equal(res.json().code, 'UNKNOWN_PLACE');
  }
  for (const bad of ['SVO-B', '-svo', 'a', 'x'.repeat(65), 5, null]) {
    const res = await post(app, '/api/v1/orders', { pickup: { label: 'x', placeId: bad }, dropoff: { label: 'y' } }, owner);
    assert.equal(res.statusCode, 400, String(bad));
  }
});
