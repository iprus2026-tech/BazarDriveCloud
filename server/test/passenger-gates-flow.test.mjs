// /server/test/passenger-gates-flow.test.mjs — DB-gated end-to-end for BD-AUTH-POLICY-01B-C
// (docs/driver-role-grant-contract.md §4) through the real Fastify app + real Postgres:
//   - POST /orders, GET /matching/offers and POST /matching/select require a granted, active
//     passenger role, checked before any order lookup; a driver-mode session gets
//     403 PASSENGER_ROLE_REQUIRED and nothing is written;
//   - a dual-role account switches to passenger (PUT /auth/session/active-role) and succeeds;
//   - /select re-checks the selected driver's CURRENT grant: 409 DRIVER_NOT_ELIGIBLE, nothing written;
//   - an authority lookup failure is a retryable 503 and writes nothing.
// SKIPPED without DATABASE_URL; runs in server-ci's app job. Unique per-process phones; cleans up
// in t.after() (rides by trip id, then orders, which cascade offers + assignment).
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
const put = (app, url, payload, headers) => app.inject({ method: 'PUT', url, payload, headers });
const get = (app, url, headers) => app.inject({ method: 'GET', url, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });
const ORDER = { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } };
const PASSENGER_REFUSED = { error: 'a granted, active passenger role is required', code: 'PASSENGER_ROLE_REQUIRED', retryable: false };

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json(); // { token, user }
}

function harness(t, phones) {
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {}); // cascades offers + assignment
    }
    for (const p of phones) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
  });
  return { cleanup, orderIds };
}

// The order's write footprint: its status, each offer's status, and whether an assignment or a
// ride exists. A refused request must leave all of it unchanged.
async function footprint(db, legacyId) {
  const order = (await db.query('SELECT id, status FROM orders WHERE legacy_id = $1', [legacyId])).rows[0];
  const offers = (await db.query('SELECT status FROM offers WHERE order_id = $1 ORDER BY status', [order.id])).rows.map((r) => r.status);
  const assignment = (await db.query('SELECT count(*)::int AS n FROM assignment WHERE order_id = $1', [order.id])).rows[0].n;
  const rides = (await db.query('SELECT count(*)::int AS n FROM rides WHERE trip_id = $1', [`trip_${legacyId}`])).rows[0].n;
  return { status: order.status, offers, assignment, rides };
}
const orderCount = async (db, userId) => (await db.query(
  'SELECT count(*)::int AS n FROM orders WHERE passenger_id = $1', [userId])).rows[0].n;

// Record every SQL text a transaction client runs (restored afterwards).
async function captureTxSql(app, fn) {
  const originalTx = app.db.tx;
  const sql = [];
  app.db.tx = (work) => originalTx(async (client) => {
    const originalQuery = client.query;
    client.query = (...args) => {
      const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
      if (typeof text === 'string') sql.push(text);
      return originalQuery.apply(client, args);
    };
    try { return await work(client); } finally { client.query = originalQuery; }
  });
  try { return { result: await fn(), sql }; } finally { app.db.tx = originalTx; }
}

test('passenger gates: a driver-mode session is refused on all three routes and writes nothing; switching to passenger succeeds', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  t.after(() => app.close());
  const tag = String(process.pid).padStart(7, '0');
  const dual = `+1601${tag}`;
  const drv = `+1602${tag}`;
  const { cleanup, orderIds } = harness(t, [dual, drv]);
  await cleanup.connect();

  // The account creates an order as a passenger (unchanged path) and a driver offers on it.
  const dualS = await mintSession(app, dual);
  const created = await post(app, '/api/v1/orders', ORDER, bearer(dualS));
  assert.equal(created.statusCode, 201);
  const order = created.json().order;
  orderIds.push(order.id);
  const drvS = await grantDriverRole(cleanup, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: order.id, price: 800 }, bearer(drvS))).statusCode, 201);
  const before = await footprint(cleanup, order.id);
  assert.deepEqual(before, { status: 'CREATED', offers: ['sent'], assignment: 0, rides: 0 });

  // The same account now holds both roles and its session is in driver mode.
  await grantDriverRole(cleanup, dualS);
  const ordersBefore = await orderCount(cleanup, dualS.user.userId);

  const create = await post(app, '/api/v1/orders', ORDER, bearer(dualS));
  assert.equal(create.statusCode, 403);
  assert.deepEqual(create.json(), PASSENGER_REFUSED);
  assert.equal(await orderCount(cleanup, dualS.user.userId), ordersBefore, 'a refused create writes no order');

  const list = await get(app, `/api/v1/matching/offers?orderId=${order.id}`, bearer(dualS));
  assert.equal(list.statusCode, 403);
  assert.deepEqual(list.json(), PASSENGER_REFUSED);
  // The gate runs before the order lookup: an unknown order is refused the same way, not 404.
  const unknownList = await get(app, '/api/v1/matching/offers?orderId=order-does-not-exist', bearer(dualS));
  assert.deepEqual([unknownList.statusCode, unknownList.json().code], [403, 'PASSENGER_ROLE_REQUIRED']);

  const { result: select, sql } = await captureTxSql(app,
    () => post(app, '/api/v1/matching/select', { orderId: order.id, driverId: drvS.user.userId }, bearer(dualS)));
  assert.equal(select.statusCode, 403);
  assert.deepEqual(select.json(), PASSENGER_REFUSED);
  assert.ok(sql.some((text) => /\bFROM\s+users\b/i.test(text)), 'the grant lookup ran in the select tx');
  assert.equal(sql.some((text) => /\borders\b/i.test(text)), false, 'a refused select never touches the order');
  const unknownSelect = await post(app, '/api/v1/matching/select', { orderId: 'order-does-not-exist', driverId: drvS.user.userId }, bearer(dualS));
  assert.deepEqual([unknownSelect.statusCode, unknownSelect.json().code], [403, 'PASSENGER_ROLE_REQUIRED']);
  assert.deepEqual(await footprint(cleanup, order.id), before, 'refusals write nothing');

  // The dual-role account switches its session to passenger and the same requests succeed.
  const switched = await put(app, '/api/v1/auth/session/active-role', { activeRole: 'passenger' }, bearer(dualS));
  assert.equal(switched.statusCode, 200);
  const listed = await get(app, `/api/v1/matching/offers?orderId=${order.id}`, bearer(dualS));
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().items.length, 1);
  const selected = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: drvS.user.userId }, bearer(dualS));
  assert.equal(selected.statusCode, 200);
  assert.deepEqual(await footprint(cleanup, order.id), { status: 'ACCEPTED', offers: ['accepted'], assignment: 1, rides: 1 });
  const again = await post(app, '/api/v1/orders', ORDER, bearer(dualS));
  assert.equal(again.statusCode, 201);
  orderIds.push(again.json().order.id);
});

test('select re-checks the driver grant: a driver revoked after offering is not eligible (409), nothing written', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  t.after(() => app.close());
  const tag = String(process.pid).padStart(7, '0');
  const pax = `+1603${tag}`;
  const drv = `+1604${tag}`;
  const other = `+1608${tag}`;
  const idle = `+1609${tag}`;
  const { cleanup, orderIds } = harness(t, [pax, drv, other, idle]);
  await cleanup.connect();

  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const drvS = await grantDriverRole(cleanup, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: order.id, price: 900 }, bearer(drvS))).statusCode, 201);

  // No grant oracle: an account that never offered on this order is 404 OFFER_NOT_FOUND whether
  // it holds the driver grant or not (the live offer is checked before the grant).
  const noOfferPassenger = await mintSession(app, other);
  const noOfferDriver = await grantDriverRole(cleanup, await mintSession(app, idle));
  for (const [label, s] of [['a passenger-only account', noOfferPassenger], ['a granted driver', noOfferDriver]]) {
    const res = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: s.user.userId }, bearer(paxS));
    assert.deepEqual([res.statusCode, res.json().code], [404, 'OFFER_NOT_FOUND'], label + ' without an offer');
  }

  // The driver grant is revoked after the offer (as decideDriverEnrollment's revoke leaves it).
  await cleanup.query("UPDATE users SET roles = ARRAY['passenger']::text[], active_role = 'passenger' WHERE id = $1", [drvS.user.userId]);
  const before = await footprint(cleanup, order.id);
  const { result: refused, sql } = await captureTxSql(app,
    () => post(app, '/api/v1/matching/select', { orderId: order.id, driverId: drvS.user.userId }, bearer(paxS)));
  assert.equal(refused.statusCode, 409);
  assert.deepEqual(refused.json(),
    { error: 'the selected driver can no longer take this order', code: 'DRIVER_NOT_ELIGIBLE', retryable: false });
  assert.deepEqual(await footprint(cleanup, order.id), before, 'nothing written');
  assert.deepEqual(before, { status: 'CREATED', offers: ['sent'], assignment: 0, rides: 0 });
  // Order: passenger authority, the order lock, the live offer, then the driver's grant FOR SHARE.
  const first = (re) => sql.findIndex((text) => re.test(text));
  assert.ok(first(/\bFROM\s+users\b/i) < first(/\bFROM\s+orders\b/i), 'authority before the order lock');
  assert.ok(first(/\bFROM\s+orders\b/i) < first(/\bFROM\s+offers\b/i), 'the live offer is read under the order lock');
  assert.ok(first(/\bFROM\s+offers\b/i) < first(/\bFOR\s+SHARE\b/i), 'the driver grant is read only after a live offer is found');
  assert.equal(sql.some((text) => /^\s*UPDATE\s+offers\b/i.test(text)), false, 'no offer is accepted');

  // The grant is restored: the same selection succeeds.
  await cleanup.query("UPDATE users SET roles = ARRAY['passenger','driver']::text[] WHERE id = $1", [drvS.user.userId]);
  const accepted = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: drvS.user.userId }, bearer(paxS));
  assert.equal(accepted.statusCode, 200);
  assert.equal((await footprint(cleanup, order.id)).status, 'ACCEPTED');
});

test('passenger gates: an authority lookup failure is a retryable 503 and writes nothing', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  t.after(() => app.close());
  const tag = String(process.pid).padStart(7, '0');
  const pax = `+1605${tag}`;
  const drv = `+1606${tag}`;
  const { cleanup, orderIds } = harness(t, [pax, drv]);
  await cleanup.connect();

  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders', ORDER, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const drvS = await grantDriverRole(cleanup, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { orderId: order.id }, bearer(drvS))).statusCode, 201);
  const before = await footprint(cleanup, order.id);
  const ordersBefore = await orderCount(cleanup, paxS.user.userId);

  // Fail exactly the authority read (findUserAuthorityById), on the pool and on tx clients.
  const isAuthorityRead = (text) => /SELECT\s+id,\s*roles,\s*phone_verified\s+FROM\s+users/i.test(text);
  const failing = (query) => (...args) => {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (typeof text === 'string' && isAuthorityRead(text)) return Promise.reject(new Error('injected authority lookup failure'));
    return query(...args);
  };
  const originalQuery = app.db.query;
  const originalTx = app.db.tx;
  app.db.query = failing(originalQuery.bind(app.db));
  app.db.tx = (work) => originalTx(async (client) => {
    const clientQuery = client.query;
    client.query = failing(clientQuery.bind(client));
    try { return await work(client); } finally { client.query = clientQuery; }
  });
  const UNAVAILABLE = { error: 'authority lookup failed', code: 'AUTHORITY_LOOKUP_FAILED', retryable: true };
  try {
    const create = await post(app, '/api/v1/orders', ORDER, bearer(paxS));
    assert.deepEqual([create.statusCode, create.json()], [503, UNAVAILABLE]);
    const list = await get(app, `/api/v1/matching/offers?orderId=${order.id}`, bearer(paxS));
    assert.deepEqual([list.statusCode, list.json()], [503, UNAVAILABLE]);
    const select = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: drvS.user.userId }, bearer(paxS));
    assert.deepEqual([select.statusCode, select.json()], [503, UNAVAILABLE]);
  } finally {
    app.db.query = originalQuery;
    app.db.tx = originalTx;
  }
  assert.equal(await orderCount(cleanup, paxS.user.userId), ordersBefore);
  assert.deepEqual(await footprint(cleanup, order.id), before);
});

test('login backfill: a legacy roleless account gets the passenger grant at verify and may create an order', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  t.after(() => app.close());
  const legacy = `+1607${String(process.pid).padStart(7, '0')}`;
  const { cleanup, orderIds } = harness(t, [legacy]);
  await cleanup.connect();

  // A pre-#1017 account: verified phone, no grants, no active role.
  await cleanup.query(
    "INSERT INTO users (phone, phone_verified, roles, active_role) VALUES ($1, TRUE, '{}'::text[], NULL)", [legacy]);
  const s = await mintSession(app, legacy);
  assert.equal(s.user.activeRole, 'passenger', 'the new session is minted as passenger');
  const row = (await cleanup.query('SELECT roles, active_role FROM users WHERE phone = $1', [legacy])).rows[0];
  assert.deepEqual([row.roles, row.active_role], [['passenger'], 'passenger']);
  const created = await post(app, '/api/v1/orders', ORDER, bearer(s));
  assert.equal(created.statusCode, 201);
  orderIds.push(created.json().order.id);
});
