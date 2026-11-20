// /server/test/order-edit-flow.test.mjs — DB-gated end-to-end for #1188 through the real Fastify
// app + Postgres: PATCH /orders/:orderId, the owner's edit of an open order.
//   - gates: 401, the passenger role, the owner, 404; a body that names the route, is empty or out
//     of range is a 400;
//   - a time / comment edit keeps the open offers, marked `previousTermsAt`; the driver's re-send
//     clears the mark; a repeated request and a label-only write change nothing for the offers;
//   - a price edit rejects the open offers (rejected_by = 'passenger_edit'); the driver offers
//     again as a new bid; any other rejection stays terminal;
//   - an order with a driver, or a canceled one, is 409 ORDER_NOT_EDITABLE;
//   - a comment stored only in the passenger snapshot is cleared in both copies; a new price sent
//     without a label gets a label for that price (so the ride does not show the old one);
//   - a time change without a label clears the stored time label; a repeated price with more than
//     two decimals is a no-op (it is stored as NUMERIC(12,2)) and rejects no later offer;
//   - /readyz reports schema-incomplete on a database without migration 0016 (an isolated one).
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
const get = (app, url, headers) => app.inject({ method: 'GET', url, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });
const PLATE = 'А 123 ВС 77';
const ORDER = {
  pickup: { label: 'Ленина, 1' }, dropoff: { label: 'Аэропорт' },
  estimatedPrice: 500, estimatedPriceLabel: '500 ₽', comment: 'Подъезд 2',
};
const orderUrl = (orderId) => `/api/v1/orders/${encodeURIComponent(orderId)}`;
const offersUrl = (orderId) => `/api/v1/matching/offers?orderId=${encodeURIComponent(orderId)}`;

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}
async function offerRows(db, orderId) {
  const { rows } = await db.query(
    `SELECT f.driver_id, f.status, f.price, f.message, f.rejected_by, f.rejected_reason,
            f.rejected_at IS NOT NULL AS rejected_stamped, f.previous_terms_at IS NOT NULL AS previous_terms,
            f.expires_at
       FROM offers f JOIN orders o ON o.id = f.order_id WHERE o.legacy_id = $1 ORDER BY f.created_at`, [orderId]);
  return rows;
}
async function setup(t, prefixes) {
  const app = await buildApp({ config: baseConfig });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const tag = String(process.pid).padStart(7, '0');
  const phones = prefixes.map((p) => `${p}${tag}`);
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      const tripIds = orderIds.map((id) => `trip_${id}`);
      await db.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
      await db.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
      await db.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    for (const p of phones) {
      await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await db.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await db.end();
    await app.close();
  });
  return { app, db, phones, orderIds };
}

test('order edit: gates and validation', { skip: SKIP }, async (t) => {
  const { app, db, phones: [pax, drv, other], orderIds } = await setup(t, ['+1631', '+1632', '+1633']);
  const paxS = await mintSession(app, pax);
  const orderId = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order.id;
  orderIds.push(orderId);
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  const otherS = await mintSession(app, other);
  const edit = { comment: 'Новый комментарий' };

  assert.equal((await patch(app, orderUrl(orderId), edit)).statusCode, 401);
  const unknown = await patch(app, orderUrl('order-nope'), edit, bearer(paxS));
  assert.deepEqual([unknown.statusCode, unknown.json().code], [404, 'ORDER_NOT_FOUND']);
  const foreign = await patch(app, orderUrl(orderId), edit, bearer(otherS));
  assert.deepEqual([foreign.statusCode, foreign.json().code], [403, 'FORBIDDEN']);
  const driverMode = await patch(app, orderUrl(orderId), edit, bearer(drvS));
  assert.deepEqual([driverMode.statusCode, driverMode.json().code], [403, 'PASSENGER_ROLE_REQUIRED']);

  // The route is not editable, an empty edit is not an edit, and the terms keep the create limits.
  for (const body of [
    {}, { pickup: { label: 'Другая улица, 5' } }, { dropoff: { label: 'Вокзал' } }, { distanceKm: 3 },
    { status: 'CANCELED' }, { estimatedPrice: -1 }, { estimatedPrice: '800' }, { scheduledMode: 'tomorrow' },
    { comment: 'x'.repeat(1001) },
  ]) {
    const res = await patch(app, orderUrl(orderId), body, bearer(paxS));
    assert.equal(res.statusCode, 400, `${JSON.stringify(body).slice(0, 60)} -> ${res.body}`);
  }
  const { rows: [row] } = await db.query(
    'SELECT comment, estimated_price, terms_changed_at, price_changed_at, pickup FROM orders WHERE legacy_id = $1', [orderId]);
  assert.deepEqual(
    [row.comment, Number(row.estimated_price), row.terms_changed_at, row.price_changed_at, row.pickup.label],
    ['Подъезд 2', 500, null, null, 'Ленина, 1'], 'a refused edit writes nothing');
});

test('a time or comment edit keeps the offers, marked as made for the previous terms', { skip: SKIP }, async (t) => {
  const { app, db, phones: [pax, drv], orderIds } = await setup(t, ['+1634', '+1635']);
  const paxS = await mintSession(app, pax);
  const created = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order;
  const orderId = created.id;
  orderIds.push(orderId);
  assert.deepEqual([created.termsChangedAt, created.priceChangedAt], [null, null]);
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  const offer = { vehiclePlate: PLATE, orderId, price: 650, message: 'Буду через 5 минут' };
  const sent = await post(app, '/api/v1/matching/offers', offer, bearer(drvS));
  assert.deepEqual([sent.statusCode, sent.json().offer.previousTermsAt], [201, null]);

  // A reformatted label with the same price is written, but it is not a change of terms.
  const label = await patch(app, orderUrl(orderId), { estimatedPrice: 500, estimatedPriceLabel: '500 руб.' }, bearer(paxS));
  assert.deepEqual(
    [label.statusCode, label.json().order.estimatedPriceLabel, label.json().order.termsChangedAt], [200, '500 руб.', null]);
  assert.equal((await offerRows(db, orderId))[0].previous_terms, false);

  const edited = await patch(app, orderUrl(orderId), {
    comment: 'Подъезд 3, домофон 12', scheduledMode: 'later', scheduledAt: '2026-12-01T10:00', scheduledLabel: '1 дек, 10:00',
  }, bearer(paxS));
  assert.equal(edited.statusCode, 200, edited.body);
  const order = edited.json().order;
  assert.deepEqual(
    [order.comment, order.scheduledMode, order.scheduledAt, order.scheduledLabel, order.estimatedPrice, order.status, order.priceChangedAt],
    ['Подъезд 3, домофон 12', 'later', '2026-12-01T10:00', '1 дек, 10:00', 500, 'CREATED', null]);
  assert.ok(order.termsChangedAt, 'the edit is stamped');
  assert.deepEqual([order.pickup.label, order.dropoff.label], ['Ленина, 1', 'Аэропорт'], 'the route is untouched');

  // The offer stays selectable and carries the mark; its own time is not bumped by the edit.
  const listed = (await get(app, offersUrl(orderId), bearer(paxS))).json().items;
  assert.deepEqual(listed.map((o) => [o.status, o.price, !!o.previousTermsAt]), [['sent', 650, true]]);
  assert.equal(listed[0].updatedAt, sent.json().offer.updatedAt);

  // A repeated request changes nothing: same stamp, same mark.
  const again = await patch(app, orderUrl(orderId), { comment: 'Подъезд 3, домофон 12' }, bearer(paxS));
  assert.deepEqual([again.statusCode, again.json().order.termsChangedAt], [200, order.termsChangedAt]);

  // The driver sees the change on the public projection (no comment there) and answers it.
  const feedOrder = (await get(app, '/api/v1/orders', bearer(drvS))).json().items.find((o) => o.id === orderId);
  assert.deepEqual([feedOrder.projection, feedOrder.comment, feedOrder.termsChangedAt], ['public', '', order.termsChangedAt]);
  const resent = await post(app, '/api/v1/matching/offers', offer, bearer(drvS));
  assert.deepEqual([resent.statusCode, resent.json().offer.status, resent.json().offer.previousTermsAt], [201, 'sent', null]);

  // A second edit marks it again; selecting a marked offer is allowed, and the ride carries the new comment.
  assert.equal((await patch(app, orderUrl(orderId), { comment: '' }, bearer(paxS))).statusCode, 200);
  assert.equal((await offerRows(db, orderId))[0].previous_terms, true);
  const selected = await post(app, '/api/v1/matching/select', { orderId, driverId: drvS.user.userId }, bearer(paxS));
  assert.equal(selected.statusCode, 200, selected.body);
  const { rows: [ride] } = await db.query('SELECT passenger_note FROM rides WHERE trip_id = $1', [`trip_${orderId}`]);
  assert.equal(ride.passenger_note, null, 'a cleared comment does not come back through the snapshot');
});

test('a price edit rejects the open offers; the driver offers again as a new bid', { skip: SKIP }, async (t) => {
  const { app, db, phones: [pax, drvA, drvB], orderIds } = await setup(t, ['+1636', '+1637', '+1638']);
  const paxS = await mintSession(app, pax);
  const orderId = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order.id;
  orderIds.push(orderId);
  const aS = await grantDriverRole(db, await mintSession(app, drvA));
  const bS = await grantDriverRole(db, await mintSession(app, drvB));
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId, price: 650, message: 'За 650 поеду' }, bearer(aS))).statusCode, 201);
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId, price: 700 }, bearer(bS))).statusCode, 201);
  // An earlier comment edit marked both offers; the price edit below rejects them and drops the mark.
  assert.equal((await patch(app, orderUrl(orderId), { comment: 'Подъезд 4' }, bearer(paxS))).statusCode, 200);
  assert.deepEqual((await offerRows(db, orderId)).map((o) => o.previous_terms), [true, true]);
  const before = await offerRows(db, orderId);

  const edited = await patch(app, orderUrl(orderId), { estimatedPrice: 800, estimatedPriceLabel: '800 ₽', comment: 'Багаж' }, bearer(paxS));
  assert.equal(edited.statusCode, 200, edited.body);
  const order = edited.json().order;
  assert.deepEqual([order.estimatedPrice, order.estimatedPriceLabel, order.comment, order.status], [800, '800 ₽', 'Багаж', 'CREATED']);
  assert.ok(order.priceChangedAt && order.termsChangedAt);
  const rejected = await offerRows(db, orderId);
  assert.deepEqual(
    rejected.map((o) => [o.status, o.rejected_by, o.rejected_reason, o.rejected_stamped, o.previous_terms]),
    [['rejected', 'passenger_edit', 'order_price_changed', true, false], ['rejected', 'passenger_edit', 'order_price_changed', true, false]]);
  const stale = await post(app, '/api/v1/matching/select', { orderId, driverId: aS.user.userId }, bearer(paxS));
  assert.deepEqual([stale.statusCode, stale.json().code], [404, 'OFFER_NOT_FOUND'], 'a bid on the old price is not selectable');

  // Driver A offers again without a price: the old bid and message do not carry over.
  await new Promise((r) => setTimeout(r, 20));
  const reoffer = await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId }, bearer(aS));
  assert.deepEqual(
    [reoffer.statusCode, reoffer.json().offer.status, reoffer.json().offer.price, reoffer.json().offer.message],
    [201, 'sent', null, null]);
  const after = await offerRows(db, orderId);
  const a = after.find((o) => o.driver_id === aS.user.userId);
  assert.deepEqual([a.rejected_by, a.rejected_reason, a.rejected_stamped], [null, null, false], 'the rejection marks are dropped');
  assert.ok(a.expires_at > before.find((o) => o.driver_id === aS.user.userId).expires_at, 'a new bid gets a fresh expiry');

  // Any other rejection stays terminal: a re-send answers with the stored offer, unchanged.
  await db.query(
    `UPDATE offers SET rejected_by = 'passenger' WHERE driver_id = $1 AND order_id = (SELECT id FROM orders WHERE legacy_id = $2)`,
    [bS.user.userId, orderId]);
  const terminal = await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId, price: 750 }, bearer(bS));
  assert.deepEqual([terminal.statusCode, terminal.json().offer.status, terminal.json().offer.price], [201, 'rejected', 700]);

  const selected = await post(app, '/api/v1/matching/select', { orderId, driverId: aS.user.userId }, bearer(paxS));
  assert.equal(selected.statusCode, 200, selected.body);
  assert.equal(selected.json().offer.status, 'accepted');
});

test('an order with a driver, or a canceled one, is not editable', { skip: SKIP }, async (t) => {
  const { app, db, phones: [pax, drv], orderIds } = await setup(t, ['+1639', '+1641']);
  const paxS = await mintSession(app, pax);
  const drvS = await grantDriverRole(db, await mintSession(app, drv));

  const acceptedId = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order.id;
  orderIds.push(acceptedId);
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId: acceptedId, price: 650 }, bearer(drvS))).statusCode, 201);
  assert.equal((await post(app, '/api/v1/matching/select', { orderId: acceptedId, driverId: drvS.user.userId }, bearer(paxS))).statusCode, 200);
  const late = await patch(app, orderUrl(acceptedId), { estimatedPrice: 100, estimatedPriceLabel: '100 ₽' }, bearer(paxS));
  assert.deepEqual([late.statusCode, late.json().code], [409, 'ORDER_NOT_EDITABLE']);
  const { rows: [accepted] } = await db.query(
    `SELECT o.estimated_price, f.status FROM orders o JOIN offers f ON f.order_id = o.id WHERE o.legacy_id = $1`, [acceptedId]);
  assert.deepEqual([Number(accepted.estimated_price), accepted.status], [500, 'accepted'], 'nothing moved');

  const canceledId = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order.id;
  orderIds.push(canceledId);
  assert.equal((await post(app, `${orderUrl(canceledId)}/cancel`, undefined, bearer(paxS))).statusCode, 200);
  const dead = await patch(app, orderUrl(canceledId), { comment: 'Поздно' }, bearer(paxS));
  assert.deepEqual([dead.statusCode, dead.json().code], [409, 'ORDER_NOT_EDITABLE']);
});

test('an edit leaves no comment in the snapshot and no label for another price', { skip: SKIP }, async (t) => {
  const { app, db, phones: [pax, drv], orderIds } = await setup(t, ['+1642', '+1643']);
  const paxS = await mintSession(app, pax);
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  // The comment travels only in the passenger snapshot; the order's own comment is empty.
  const body = { ...ORDER, comment: '', passenger: { name: 'Анна', comment: 'Позвоните у подъезда' } };
  const orderId = (await post(app, '/api/v1/orders', body, bearer(paxS))).json().order.id;
  orderIds.push(orderId);
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId, etaMin: 5 }, bearer(drvS))).statusCode, 201);

  const cleared = await patch(app, orderUrl(orderId), { comment: '' }, bearer(paxS));
  assert.equal(cleared.statusCode, 200, cleared.body);
  assert.ok(cleared.json().order.termsChangedAt, 'clearing the snapshot comment is a change of terms');
  const { rows: [stored] } = await db.query(
    `SELECT comment, passenger_snapshot->>'comment' AS snap, passenger_snapshot->>'name' AS name FROM orders WHERE legacy_id = $1`, [orderId]);
  assert.deepEqual([stored.comment, stored.snap, stored.name], ['', '', 'Анна'], 'both copies are cleared; the rest of the snapshot stays');
  assert.equal((await offerRows(db, orderId))[0].previous_terms, true);

  // A new price without a label: the stored label follows the price, and the open offer is rejected.
  const priced = await patch(app, orderUrl(orderId), { estimatedPrice: 800 }, bearer(paxS));
  assert.deepEqual([priced.statusCode, priced.json().order.estimatedPrice, priced.json().order.estimatedPriceLabel],
    [200, 800, `${(800).toLocaleString('ru-RU')} ₽`]);
  assert.equal((await offerRows(db, orderId))[0].rejected_by, 'passenger_edit');

  // The driver offers again with no price of their own: the ride is priced at the new estimate
  // and carries no comment.
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId }, bearer(drvS))).statusCode, 201);
  assert.equal((await post(app, '/api/v1/matching/select', { orderId, driverId: drvS.user.userId }, bearer(paxS))).statusCode, 200);
  const { rows: [ride] } = await db.query('SELECT passenger_note, ride_price FROM rides WHERE trip_id = $1', [`trip_${orderId}`]);
  assert.deepEqual([ride.passenger_note, ride.ride_price], [null, `${(800).toLocaleString('ru-RU')} ₽`]);
});

test('a time edit drops the old time label; a repeated sub-cent price rejects no offer', { skip: SKIP }, async (t) => {
  const { app, db, phones: [pax, drv], orderIds } = await setup(t, ['+1644', '+1645']);
  const paxS = await mintSession(app, pax);
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  const body = { ...ORDER, scheduledMode: 'later', scheduledAt: '2026-12-01T10:00', scheduledLabel: '1 дек, 10:00' };
  const orderId = (await post(app, '/api/v1/orders', body, bearer(paxS))).json().order.id;
  orderIds.push(orderId);

  const moved = await patch(app, orderUrl(orderId), { scheduledAt: '2026-12-02T12:00' }, bearer(paxS));
  assert.equal(moved.statusCode, 200, moved.body);
  assert.deepEqual([moved.json().order.scheduledAt, moved.json().order.scheduledLabel], ['2026-12-02T12:00', '']);

  const first = await patch(app, orderUrl(orderId), { estimatedPrice: 800.001 }, bearer(paxS));
  assert.deepEqual([first.statusCode, first.json().order.estimatedPrice, first.json().order.estimatedPriceLabel],
    [200, 800, `${(800).toLocaleString('ru-RU')} ₽`]);
  // A driver offers after the edit; the same request again must not reject that offer.
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: PLATE, orderId, etaMin: 5 }, bearer(drvS))).statusCode, 201);
  const again = await patch(app, orderUrl(orderId), { estimatedPrice: 800.001 }, bearer(paxS));
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().order.priceChangedAt, first.json().order.priceChangedAt);
  const [offer] = await offerRows(db, orderId);
  assert.deepEqual([offer.status, offer.rejected_by, offer.previous_terms], ['sent', null, false]);
});

test('readiness: a database without migration 0016 is schema-incomplete', { skip: SKIP }, async (t) => {
  const admin = new pg.Client({ connectionString: DATABASE_URL });
  await admin.connect();
  const dbName = `bazardrive_m0016_${process.pid}_${Date.now()}`;
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
  const M0016 = '0016_order_edit_terms.sql';
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes(M0016));
  for (const f of files.filter((name) => name < M0016)) await db.query(fs.readFileSync(new URL(f, dir), 'utf8'));

  app = await buildApp({ config: { ...baseConfig, databaseUrl: url.toString() } });
  const readyz = async () => { const res = await get(app, '/api/v1/readyz'); return [res.statusCode, res.json().db]; };
  assert.deepEqual(await readyz(), [503, 'schema-incomplete'], 'migrations up to 0015 only');
  await db.query(fs.readFileSync(new URL(M0016, dir), 'utf8'));
  assert.deepEqual(await readyz(), [200, 'up']);
  // Each column is load-bearing on its own.
  for (const [table, column] of [['orders', 'terms_changed_at'], ['orders', 'price_changed_at'], ['offers', 'previous_terms_at']]) {
    await db.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
    assert.deepEqual(await readyz(), [503, 'schema-incomplete'], `${table}.${column} missing`);
    await db.query(fs.readFileSync(new URL(M0016, dir), 'utf8'));
    assert.deepEqual(await readyz(), [200, 'up']);
  }
});
