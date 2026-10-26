// /server/test/orders-flow.test.mjs — DB-gated end-to-end for R03 (#1 Order Dispatcher) through
// the real Fastify app + real Postgres. Mints a session via the live OTP flow (R02), creates an
// order (POST, auth-gated), and reads it back (GET, auth-gated since BD-ORDERS-PUBLIC-PROJECTION-01
// #1125) — asserting the feed shape, the PER-VIEWER isCurrentUser recompute (owner=true,
// other=false), and the owner/public projections (exact vs street-only). SKIPPED without DATABASE_URL;
// runs in server-ci's app job. Cleans up its rows (unique per-process phones) in t.after().
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
const getFeed = (app, headers) => app.inject({ method: 'GET', url: '/api/v1/orders', headers });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json(); // { token, user }
}

test('order create (auth) -> feed list (public); per-viewer isCurrentUser', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const phone = `+1571${String(process.pid).padStart(7, '0')}`;
  const phone2 = `+1572${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const createdIds = [];
  t.after(async () => {
    if (createdIds.length) {
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [createdIds]).catch(() => {});
    }
    for (const p of [phone, phone2]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  // unauthenticated create (even with a valid body) is refused at the auth gate.
  assert.equal((await post(app, '/api/v1/orders', { pickup: { label: 'A' }, dropoff: { label: 'B' } })).statusCode, 401);

  // mint a session.
  const me = await mintSession(app, phone);

  // an AUTHENTICATED request still needs a usable route — an incomplete body is 400 VALIDATION,
  // never a published null-route order (Codex #789).
  const incomplete = await post(app, '/api/v1/orders', { comment: 'x' }, { authorization: `Bearer ${me.token}` });
  assert.equal(incomplete.statusCode, 400, 'authenticated create requires pickup+dropoff');
  assert.equal(incomplete.json().code, 'VALIDATION');

  // create an order.
  const created = await post(app, '/api/v1/orders', {
    type: 'ride_order', source: 'map', comment: 'к центру',
    pickup: { lng: 37.6, lat: 55.7, label: 'Дом' }, dropoff: { lng: 37.7, lat: 55.8, label: 'Центр' },
    estimatedPrice: 480, estimatedPriceLabel: '480 ₽',
    passenger: { name: 'Я', isCurrentUser: true, authorId: 'spoofed' }, // server must ignore both
  }, { authorization: `Bearer ${me.token}` });
  assert.equal(created.statusCode, 201);
  const order = created.json().order;
  assert.match(order.id, /^order-/, 'server-minted legacy id');
  assert.equal(order.status, 'CREATED');
  assert.equal(order.comment, 'к центру');
  assert.deepEqual(order.pickup, { lng: 37.6, lat: 55.7, label: 'Дом' });
  assert.equal(order.passenger.isCurrentUser, true, 'owner sees their own new order as mine');
  assert.deepEqual(Object.keys(order.passenger), ['isCurrentUser'], 'no passenger PII on the public projection');
  createdIds.push(order.id);

  // The STORED snapshot ignored the spoofed authorId/isCurrentUser and forced the real owner
  // (sanitizeSnapshot) — verified directly in the DB, since the API no longer echoes it.
  const stored = (await cleanup.query('SELECT passenger_snapshot AS s FROM orders WHERE legacy_id = $1', [order.id])).rows[0].s;
  assert.equal(stored.authorId, me.user.userId, 'stored authorId is the authenticated owner, not "spoofed"');
  assert.equal(stored.name, 'Я', 'stored snapshot keeps the (sanitized) name for the future handoff');
  assert.equal(stored.isCurrentUser, undefined, 'stored snapshot does not persist the per-viewer flag');

  // #1125 R1: the feed requires a session.
  const feedAnon = await getFeed(app);
  assert.equal(feedAnon.statusCode, 401);
  assert.equal(feedAnon.json().code, 'UNAUTHENTICATED');

  // a DIFFERENT authenticated viewer must NOT see it as mine, and gets the public projection:
  // the order is listed, but no exact address, coordinates or comment (#1125 R2).
  const other = await mintSession(app, phone2);
  const mineOther = (await getFeed(app, { authorization: `Bearer ${other.token}` }))
    .json().items.find((o) => o.id === order.id);
  assert.ok(mineOther, 'created order is in the feed');
  assert.equal(mineOther.passenger.isCurrentUser, false, 'another user does not own it');
  assert.equal(mineOther.passenger.name, undefined, 'the feed leaks no passenger name');
  assert.equal(mineOther.passenger.authorId, undefined, 'the feed leaks no internal user id');
  assert.equal(mineOther.projection, 'public');
  // The public label is a whitelist of «street type + name»: «Дом» / «Центр» are not streets,
  // so other people see no point at all (and never the coordinates).
  assert.equal(mineOther.pickup, null, 'a label that is not a street is not shown');
  assert.equal(mineOther.dropoff, null);
  assert.equal(mineOther.comment, '', 'no comment for non-owners');

  // the owner DOES see it as mine, in full.
  const mineMe = (await getFeed(app, { authorization: `Bearer ${me.token}` }))
    .json().items.find((o) => o.id === order.id);
  assert.equal(mineMe.passenger.isCurrentUser, true, 'owner sees it as mine');
  assert.equal(mineMe.projection, 'owner');
  assert.deepEqual(mineMe.pickup, { lng: 37.6, lat: 55.7, label: 'Дом' });
  assert.equal(mineMe.comment, 'к центру');
});
