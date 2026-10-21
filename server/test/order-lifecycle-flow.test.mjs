// /server/test/order-lifecycle-flow.test.mjs — DB-gated end-to-end for the order-lifecycle contract
// (2026-10-21; #1049 D8, #1050 D9 server side, #1051 D10) through the real Fastify app + Postgres:
//   - POST /orders/:orderId/cancel: the owner withdraws an order before selection (CREATED ->
//     CANCELED, open offers rejected); repeat 200; ACCEPTED+ -> 409 ORDER_NOT_CANCELABLE;
//     passenger gate, owner check, 404;
//   - the order (and on a cancel / no-show the assignment) follows the ride in the PATCH transaction:
//     IN_PROGRESS -> IN_PROGRESS, COMPLETED -> COMPLETED, CANCELED / NO_SHOW -> CANCELED (+ the
//     assignment canceled by the ride's actor; NO_SHOW -> driver); both recovery GETs keep passing;
//   - migration 0011 on an ISOLATED temporary database: it refuses an underivable cancel actor and
//     changes nothing, then aligns pre-sync rows, and a second apply changes nothing.
// SKIPPED without DATABASE_URL; runs in server-ci's app job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

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

const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const put = (app, url, payload, headers) => app.inject({ method: 'PUT', url, payload, headers });
const get = (app, url, headers) => app.inject({ method: 'GET', url, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });
const ORDER = { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } };

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

// order -> offer -> select: { paxS, drvS, orderId, tripId }
async function acceptedRide(app, db, pax, drv) {
  const paxS = await mintSession(app, pax);
  const orderId = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order.id;
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId, price: 700 }, bearer(drvS))).statusCode, 201);
  assert.equal((await post(app, '/api/v1/matching/select', { orderId, driverId: drvS.user.userId }, bearer(paxS))).statusCode, 200);
  return { paxS, drvS, orderId, tripId: `trip_${orderId}` };
}
const rideUrl = (tripId) => `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`;
async function drive(app, s, tripId, statuses) {
  for (const status of statuses) {
    const res = await patch(app, rideUrl(tripId) + '/status', { status }, bearer(s));
    assert.equal(res.statusCode, 200, `driver -> ${status}: ${res.body}`);
  }
}
async function pair(db, orderId) {
  const { rows: [r] } = await db.query(
    `SELECT o.status AS order_status, a.status AS assignment_status, a.canceled_by, a.canceled_at,
            ri.status AS ride_status, ri.canceled_at AS ride_canceled_at
       FROM orders o LEFT JOIN assignment a ON a.order_id = o.id LEFT JOIN rides ri ON ri.order_id = o.id
      WHERE o.legacy_id = $1`, [orderId]);
  return r;
}
async function recoveryReads(app, s, orderId, tripId) {
  return [(await get(app, rideUrl(tripId), bearer(s))).statusCode,
    (await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(orderId)}`, bearer(s))).statusCode];
}
function harness(t, db, phones) {
  const orderIds = [];
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
  return orderIds;
}

test('order cancel before selection: CREATED -> CANCELED, open offers rejected, gates and conflicts', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: baseConfig });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const tag = String(process.pid).padStart(7, '0');
  const [pax, drv, other] = [`+1611${tag}`, `+1612${tag}`, `+1613${tag}`];
  const orderIds = harness(t, db, [pax, drv, other]);
  t.after(async () => { await db.end(); await app.close(); });

  const paxS = await mintSession(app, pax);
  const orderId = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order.id;
  orderIds.push(orderId);
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId, price: 650 }, bearer(drvS))).statusCode, 201);
  const cancelUrl = `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`;

  // Gates: unknown order, another passenger, a driver-mode session.
  assert.deepEqual((await post(app, '/api/v1/orders/order-nope/cancel', undefined, bearer(paxS))).json().code, 'ORDER_NOT_FOUND');
  const otherS = await mintSession(app, other);
  const foreign = await post(app, cancelUrl, undefined, bearer(otherS));
  assert.deepEqual([foreign.statusCode, foreign.json().code], [403, 'FORBIDDEN']);
  const driverMode = await post(app, cancelUrl, undefined, bearer(drvS));
  assert.deepEqual([driverMode.statusCode, driverMode.json().code], [403, 'PASSENGER_ROLE_REQUIRED']);
  assert.equal((await post(app, cancelUrl)).statusCode, 401);

  const canceled = await post(app, cancelUrl, undefined, bearer(paxS));
  assert.equal(canceled.statusCode, 200);
  assert.equal(canceled.json().order.status, 'CANCELED');
  const { rows: offers } = await db.query(
    `SELECT f.status, f.rejected_by, f.rejected_reason, f.rejected_at IS NOT NULL AS stamped
       FROM offers f JOIN orders o ON o.id = f.order_id WHERE o.legacy_id = $1`, [orderId]);
  assert.deepEqual(offers, [{ status: 'rejected', rejected_by: 'passenger_cancel', rejected_reason: 'order_canceled_by_passenger', stamped: true }]);
  const again = await post(app, cancelUrl, undefined, bearer(paxS));
  assert.deepEqual([again.statusCode, again.json().order.status], [200, 'CANCELED'], 'a repeat is idempotent');

  // The canceled order leaves the feed, takes no offers or selection, and still lists its offers.
  const feed = (await get(app, '/api/v1/orders', bearer(drvS))).json().items.map((o) => o.id);
  assert.equal(feed.includes(orderId), false, 'the canceled order leaves the feed');
  const lateOffer = await post(app, '/api/v1/matching/offers', { orderId, price: 600 }, bearer(drvS));
  assert.deepEqual([lateOffer.statusCode, lateOffer.json().code], [409, 'ORDER_NOT_OPEN']);
  const lateSelect = await post(app, '/api/v1/matching/select', { orderId, driverId: drvS.user.userId }, bearer(paxS));
  assert.deepEqual([lateSelect.statusCode, lateSelect.json().code], [409, 'ORDER_NOT_OPEN']);
  const listed = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(orderId)}`, bearer(paxS));
  assert.equal(listed.statusCode, 200, 'a canceled order with nothing to recover lists like a CREATED one');
  assert.deepEqual(listed.json().items.map((o) => o.status), ['rejected']);
});

test('an order with a driver is not canceled through the order route (409); the ride cancel moves it', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: baseConfig });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const tag = String(process.pid).padStart(7, '0');
  const [pax, drv] = [`+1614${tag}`, `+1615${tag}`];
  const orderIds = harness(t, db, [pax, drv]);
  t.after(async () => { await db.end(); await app.close(); });

  const { paxS, orderId, tripId } = await acceptedRide(app, db, pax, drv);
  orderIds.push(orderId);
  const refused = await post(app, `/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, undefined, bearer(paxS));
  assert.deepEqual([refused.statusCode, refused.json().code], [409, 'ORDER_NOT_CANCELABLE']);
  assert.equal((await pair(db, orderId)).order_status, 'ACCEPTED');

  // The passenger cancels the RIDE with a reason: order CANCELED, assignment CANCELED by passenger.
  const res = await patch(app, rideUrl(tripId) + '/status', { status: 'CANCELED', cancel: { reason: 'changed_mind' } }, bearer(paxS));
  assert.equal(res.statusCode, 200);
  const p = await pair(db, orderId);
  assert.deepEqual([p.ride_status, p.order_status, p.assignment_status, p.canceled_by], ['CANCELED', 'CANCELED', 'CANCELED', 'passenger']);
  assert.equal(p.canceled_at.toISOString(), p.ride_canceled_at.toISOString(), 'the assignment carries the ride cancel time');
  const { rows: [r] } = await db.query('SELECT cancel_reason FROM rides WHERE trip_id = $1', [tripId]);
  assert.equal(r.cancel_reason, 'changed_mind', 'the passenger reason is stored (D9 server side)');
  assert.deepEqual(await recoveryReads(app, paxS, orderId, tripId), [200, 200], 'both recovery GETs still pass');
});

test('the order follows the ride: IN_PROGRESS, COMPLETED; driver cancel; NO_SHOW', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config: baseConfig });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const tag = String(process.pid).padStart(7, '0');
  const phones = Array.from({ length: 6 }, (_, i) => `+162${i}${tag}`);
  const orderIds = harness(t, db, phones);
  t.after(async () => { await db.end(); await app.close(); });

  // Completed ride.
  const done = await acceptedRide(app, db, phones[0], phones[1]);
  orderIds.push(done.orderId);
  await drive(app, done.drvS, done.tripId, ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS']);
  assert.deepEqual([(await pair(db, done.orderId)).order_status, (await pair(db, done.orderId)).assignment_status], ['IN_PROGRESS', 'ACCEPTED']);
  assert.deepEqual(await recoveryReads(app, done.paxS, done.orderId, done.tripId), [200, 200]);
  await drive(app, done.drvS, done.tripId, ['COMPLETED']);
  assert.deepEqual([(await pair(db, done.orderId)).order_status, (await pair(db, done.orderId)).assignment_status], ['COMPLETED', 'ACCEPTED']);
  assert.deepEqual(await recoveryReads(app, done.paxS, done.orderId, done.tripId), [200, 200]);
  // A replayed COMPLETED (idempotent ride no-op) leaves the order as it is.
  await drive(app, done.drvS, done.tripId, ['COMPLETED']);
  assert.equal((await pair(db, done.orderId)).order_status, 'COMPLETED');

  // Driver cancel.
  const dc = await acceptedRide(app, db, phones[2], phones[3]);
  orderIds.push(dc.orderId);
  const res = await patch(app, rideUrl(dc.tripId) + '/status', { status: 'CANCELED', cancel: { reason: 'car_problem' } }, bearer(dc.drvS));
  assert.equal(res.statusCode, 200);
  const dcp = await pair(db, dc.orderId);
  assert.deepEqual([dcp.order_status, dcp.assignment_status, dcp.canceled_by], ['CANCELED', 'CANCELED', 'driver']);
  assert.deepEqual(await recoveryReads(app, dc.paxS, dc.orderId, dc.tripId), [200, 200]);

  // No-show: the order is CANCELED, the assignment canceled by the driver.
  const ns = await acceptedRide(app, db, phones[4], phones[5]);
  orderIds.push(ns.orderId);
  await drive(app, ns.drvS, ns.tripId, ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'NO_SHOW']);
  const nsp = await pair(db, ns.orderId);
  assert.deepEqual([nsp.ride_status, nsp.order_status, nsp.assignment_status, nsp.canceled_by], ['NO_SHOW', 'CANCELED', 'CANCELED', 'driver']);
  assert.deepEqual(await recoveryReads(app, ns.paxS, ns.orderId, ns.tripId), [200, 200]);
});

test('migration 0011 on an isolated database: refuses an underivable actor, aligns pre-sync rows, idempotent', { skip: SKIP }, async (t) => {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  const dbName = `bazardrive_m0011_${process.pid}_${Date.now()}`;
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
  assert.ok(files.includes('0011_order_ride_lifecycle_backfill.sql'));
  for (const f of files) await db.query(fs.readFileSync(new URL(f, dir), 'utf8'));
  const m0011 = fs.readFileSync(new URL('0011_order_ride_lifecycle_backfill.sql', dir), 'utf8');

  app = await buildApp({ config: { ...baseConfig, databaseUrl: url.toString() } });
  const tag = String(process.pid).padStart(7, '0');
  const ph = (i) => `+163${i}${tag}`;
  const completed = await acceptedRide(app, db, ph(0), ph(1));
  await drive(app, completed.drvS, completed.tripId, ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED']);
  const paxCanceled = await acceptedRide(app, db, ph(2), ph(3));
  assert.equal((await patch(app, rideUrl(paxCanceled.tripId) + '/status', { status: 'CANCELED', cancel: { reason: 'changed_mind' } }, bearer(paxCanceled.paxS))).statusCode, 200);
  const noShow = await acceptedRide(app, db, ph(4), ph(5));
  await drive(app, noShow.drvS, noShow.tripId, ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'NO_SHOW']);
  const unmappable = await acceptedRide(app, db, ph(6), ph(7));

  // Simulate rows written before the PATCH kept the order in step (the shape 0011 backfills).
  for (const r of [completed, paxCanceled, noShow]) {
    await db.query(`UPDATE orders SET status = 'ACCEPTED' WHERE legacy_id = $1`, [r.orderId]);
    await db.query(`UPDATE assignment a SET status = 'ACCEPTED', canceled_by = NULL, canceled_at = NULL
                      FROM orders o WHERE o.id = a.order_id AND o.legacy_id = $1`, [r.orderId]);
  }
  // A legacy canceled ride without a participant actor.
  await db.query(`UPDATE rides SET status = 'CANCELED', canceled_at = now(), cancel_by = NULL WHERE trip_id = $1`, [unmappable.tripId]);
  assert.equal((await get(app, rideUrl(completed.tripId), bearer(completed.paxS))).statusCode, 409, 'unaligned rows fail closed');

  // 1) The underivable actor stops the whole migration; nothing changes.
  await assert.rejects(() => db.query(m0011), /0011: 1 canceled ride\(s\) without a passenger\/driver cancel_by/);
  await db.query('ROLLBACK').catch(() => {});
  assert.equal((await pair(db, completed.orderId)).order_status, 'ACCEPTED', 'nothing changed');

  // 2) Once an operator records the actor, 0011 aligns every pre-sync row.
  await db.query(`UPDATE rides SET cancel_by = 'passenger' WHERE trip_id = $1`, [unmappable.tripId]);
  await db.query(m0011);
  const after = {};
  for (const [k, r] of Object.entries({ completed, paxCanceled, noShow, unmappable })) after[k] = await pair(db, r.orderId);
  assert.deepEqual([after.completed.order_status, after.completed.assignment_status], ['COMPLETED', 'ACCEPTED']);
  assert.deepEqual([after.paxCanceled.order_status, after.paxCanceled.assignment_status, after.paxCanceled.canceled_by], ['CANCELED', 'CANCELED', 'passenger']);
  assert.equal(after.paxCanceled.canceled_at.toISOString(), after.paxCanceled.ride_canceled_at.toISOString());
  assert.deepEqual([after.noShow.order_status, after.noShow.assignment_status, after.noShow.canceled_by], ['CANCELED', 'CANCELED', 'driver']);
  assert.deepEqual([after.unmappable.order_status, after.unmappable.assignment_status, after.unmappable.canceled_by], ['CANCELED', 'CANCELED', 'passenger']);
  for (const r of [completed, paxCanceled, noShow, unmappable]) {
    assert.deepEqual(await recoveryReads(app, r.paxS, r.orderId, r.tripId), [200, 200], `${r.tripId} passes both recovery GETs`);
  }

  // 3) A second apply changes nothing (updated_at included).
  const snapshot = async () => (await db.query(
    `SELECT o.legacy_id, o.status, o.updated_at, a.status AS a_status, a.canceled_by, a.canceled_at, a.updated_at AS a_updated
       FROM orders o LEFT JOIN assignment a ON a.order_id = o.id ORDER BY o.legacy_id`)).rows;
  const before = JSON.stringify(await snapshot());
  await db.query(m0011);
  assert.equal(JSON.stringify(await snapshot()), before, 'idempotent');
});
