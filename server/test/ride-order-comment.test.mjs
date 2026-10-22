// /server/test/ride-order-comment.test.mjs — #1052: the ride carries the order comment to the driver
// (`ride.order.comment`).
//   - hermetic: the one rule (domain/ride-order-comment.js) and both ride serializers;
//   - DB-gated, through the real Fastify app + Postgres: the /select seed, the /select and PATCH
//     responses (serializeRide) and the recovery-gated GET (serializeRecoveredRide) agree, for a
//     comment, a blank comment and none; the driver participant reads it;
//   - migration 0012 on an ISOLATED temporary database: it aligns rides seeded by the old rule
//     (an empty snapshot comment hid the order comment) and a second apply changes nothing.
// The DB-gated tests are SKIPPED without DATABASE_URL; they run in server-ci's app job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

import { rideNoteText, rideOrderComment } from '../src/domain/ride-order-comment.js';
import { serializeRide, serializeRecoveredRide } from '../src/serialize.js';
import { buildApp } from '../src/server.js';
import { grantDriverRole } from '../test-support/driver-grant.mjs';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';
const baseConfig = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

test('the rule: the order comment with text wins, then the snapshot comment, else null', () => {
  assert.equal(rideOrderComment({ comment: 'Позвоните у подъезда', passenger_snapshot: { comment: 'другое' } }), 'Позвоните у подъезда');
  assert.equal(rideOrderComment({ comment: '', passenger_snapshot: { comment: 'из снимка' } }), 'из снимка');
  assert.equal(rideOrderComment({ comment: ' \t\n\v\f\r', passenger_snapshot: { comment: '  ' } }), null, 'ASCII whitespace is no text');
  assert.equal(rideOrderComment({ comment: '', passenger_snapshot: { comment: 42 } }), null, 'a non-string snapshot comment is ignored');
  assert.equal(rideOrderComment({ comment: '', passenger_snapshot: null }), null);
  assert.equal(rideOrderComment(null), null);
  assert.equal(rideOrderComment({ comment: '  с пробелами  ' }), '  с пробелами  ', 'stored verbatim, never trimmed');
  assert.equal(rideNoteText(''), null);
  assert.equal(rideNoteText(null), null);
  assert.equal(rideNoteText('ok'), 'ok');
});

test('both ride serializers expose order.comment by the same rule', () => {
  assert.equal(serializeRide({ trip_id: 't', status: 'DRIVER_EN_ROUTE', passenger_note: 'Позвоните' }).order.comment, 'Позвоните');
  assert.equal(serializeRide({ trip_id: 't', status: 'DRIVER_EN_ROUTE', passenger_note: '' }).order.comment, null);
  assert.equal(serializeRide({ trip_id: 't', status: 'DRIVER_EN_ROUTE', passenger_note: null }).order.comment, null);
  const ride = { trip_id: 't', status: 'DRIVER_EN_ROUTE', role: 'passenger', created_at: null, updated_at: null };
  const recovered = (order) => serializeRecoveredRide(ride, { order, acceptedOffer: { price: 700 } }).order;
  assert.deepEqual(recovered({ comment: 'Я у шлагбаума', passenger_snapshot: { name: 'А', comment: '' } }),
    { offerPrice: '700 ₽', comment: 'Я у шлагбаума' });
  assert.equal(recovered({ comment: '', passenger_snapshot: { name: 'А', comment: '' } }).comment, null);
});

const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const get = (app, url, headers) => app.inject({ method: 'GET', url, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });
const rideUrl = (tripId) => `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`;

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

// order (with `extra`) -> offer -> select: { paxS, drvS, orderId, tripId, select }
async function acceptedRide(app, db, pax, drv, extra = {}) {
  const paxS = await mintSession(app, pax);
  const order = { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' }, ...extra };
  const orderId = (await post(app, '/api/v1/orders', order, bearer(paxS))).json().order.id;
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: 'А 123 ВС 77', orderId, price: 700 }, bearer(drvS))).statusCode, 201);
  const select = await post(app, '/api/v1/matching/select', { orderId, driverId: drvS.user.userId }, bearer(paxS));
  assert.equal(select.statusCode, 200);
  return { paxS, drvS, orderId, tripId: `trip_${orderId}`, select: select.json() };
}

function cleanup(t, db, orderIds, phones) {
  t.after(async () => {
    if (orderIds.length) {
      await db.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await db.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await db.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    for (const p of phones) {
      await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await db.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
  });
}

test('the ride carries the order comment through /select, the recovery GET and a PATCH', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: baseConfig });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const tag = String(process.pid).padStart(7, '0');
  const phones = [0, 1, 2, 3, 4, 5].map((i) => `+166${i}${tag}`);
  const orderIds = [];
  cleanup(t, db, orderIds, phones);
  t.after(async () => { await db.end(); await app.close(); });

  const cases = [
    // The client sends an empty snapshot comment next to the order comment (sanitizePassengerSnapshot).
    { extra: { comment: 'Позвоните у подъезда', passenger: { name: 'Пётр', comment: '' } }, expected: 'Позвоните у подъезда' },
    { extra: { comment: '   ', passenger: { name: 'Пётр', comment: '' } }, expected: null },
    { extra: {}, expected: null },
  ];
  for (const [i, c] of cases.entries()) {
    const r = await acceptedRide(app, db, phones[i * 2], phones[i * 2 + 1], c.extra);
    orderIds.push(r.orderId);
    const label = JSON.stringify(c.extra);
    assert.equal(r.select.ride.order.comment, c.expected, `/select response ${label}`);
    const { rows: [row] } = await db.query('SELECT passenger_note FROM rides WHERE trip_id = $1', [r.tripId]);
    assert.equal(row.passenger_note, c.expected, `seeded rides.passenger_note ${label}`);
    for (const s of [r.paxS, r.drvS]) {
      const res = await get(app, rideUrl(r.tripId), bearer(s));
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().ride.order.comment, c.expected, `recovery GET ${label}`);
    }
    const moved = await patch(app, rideUrl(r.tripId) + '/status', { status: 'DRIVER_APPROACHING_PICKUP' }, bearer(r.drvS));
    assert.equal(moved.statusCode, 200);
    assert.equal(moved.json().ride.order.comment, c.expected, `PATCH response ${label}`);
  }
});

test('migration 0012 on an isolated database: aligns rides seeded by the old rule, idempotent', { skip: SKIP }, async (t) => {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  const dbName = `bazardrive_m0012_${process.pid}_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(DATABASE_URL);
  url.pathname = '/' + dbName;
  const db = new pg.Client({ connectionString: url.toString() });
  let app = null;
  t.after(async () => {
    if (app) await app.close().catch(() => {});
    await db.end().catch(() => {});
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName]).catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`).catch(() => {});
    await admin.end();
  });
  await db.connect();
  const dir = new URL('../migrations/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes('0012_ride_passenger_note_backfill.sql'));
  for (const f of files) await db.query(fs.readFileSync(new URL(f, dir), 'utf8'));
  const m0012 = fs.readFileSync(new URL('0012_ride_passenger_note_backfill.sql', dir), 'utf8');
  assert.match(m0012, /^[\x00-\x7F]*$/, 'ASCII only');

  app = await buildApp({ config: { ...baseConfig, databaseUrl: url.toString() } });
  const tag = String(process.pid).padStart(7, '0');
  const ph = (i) => `+167${i}${tag}`;
  const hidden = await acceptedRide(app, db, ph(0), ph(1), { comment: 'Я у шлагбаума', passenger: { name: 'Анна', comment: '' } });
  const fromSnapshot = await acceptedRide(app, db, ph(2), ph(3), { passenger: { name: 'Олег', comment: 'Из снимка' } });
  const blank = await acceptedRide(app, db, ph(4), ph(5), { comment: '', passenger: { name: 'Ира', comment: '' } });
  const terminal = await acceptedRide(app, db, ph(6), ph(7), { comment: 'Багажник занят', passenger: { name: 'Лев', comment: '' } });
  assert.equal((await patch(app, rideUrl(terminal.tripId) + '/status', { status: 'CANCELED', cancel: { reason: 'changed_mind' } }, bearer(terminal.paxS))).statusCode, 200);

  // The rows the old seed wrote: a string snapshot comment ('' here) always won.
  for (const r of [hidden, blank, terminal]) await db.query(`UPDATE rides SET passenger_note = '' WHERE trip_id = $1`, [r.tripId]);
  await db.query(`UPDATE rides SET passenger_note = NULL WHERE trip_id = $1`, [fromSnapshot.tripId]);

  await db.query(m0012);
  const notes = async () => (await db.query(
    'SELECT trip_id, passenger_note, status, updated_at FROM rides ORDER BY trip_id')).rows;
  const byTrip = Object.fromEntries((await notes()).map((r) => [r.trip_id, r]));
  assert.equal(byTrip[hidden.tripId].passenger_note, 'Я у шлагбаума');
  assert.equal(byTrip[fromSnapshot.tripId].passenger_note, 'Из снимка');
  assert.equal(byTrip[blank.tripId].passenger_note, null);
  assert.equal(byTrip[terminal.tripId].passenger_note, 'Багажник занят', 'a terminal ride is aligned too');
  assert.equal(byTrip[terminal.tripId].status, 'CANCELED', 'the status never moves');
  for (const r of [hidden, fromSnapshot, blank, terminal]) {
    const res = await patch(app, rideUrl(r.tripId) + '/status', { status: 'CANCELED', cancel: { reason: 'changed_mind' } }, bearer(r.paxS));
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().ride.order.comment, byTrip[r.tripId].passenger_note ?? null, `${r.tripId}: serializeRide follows the aligned note`);
    assert.equal((await get(app, rideUrl(r.tripId), bearer(r.drvS))).json().ride.order.comment, byTrip[r.tripId].passenger_note ?? null,
      `${r.tripId}: the recovery GET agrees`);
  }

  // A second apply changes nothing (updated_at included).
  const before = JSON.stringify(await notes());
  await db.query(m0012);
  assert.equal(JSON.stringify(await notes()), before, 'idempotent');
});
