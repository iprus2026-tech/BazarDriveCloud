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
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {}); // cascades offers + assignment
    }
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

  // R10 — the accept atomically bootstrapped the ride (no order is ACCEPTED without its ride).
  assert.ok(sel.ride, 'select response includes the bootstrapped ride');
  assert.equal(sel.ride.tripId, `trip_${order.id}`, 'ride tripId = trip_<orderId>');
  assert.equal(sel.ride.status, 'DRIVER_EN_ROUTE', 'ride starts DRIVER_EN_ROUTE');
  assert.ok(sel.ride.timestamps.acceptedAt, 'acceptedAt stamped at bootstrap');
  assert.equal(sel.ride.driver.name, 'A', 'driver seeded from the accepted offer');
  assert.equal(sel.ride.route.pickupLabel, 'Дом', 'route seeded from the order');
  assert.equal(sel.ride.order.offerPrice, '800 ₽', 'fare seeded from the accepted bid (800), not the order estimate');
  // the passenger reads the bootstrapped ride through the R06 chokepoint (and can then advance it).
  const rideSnap = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(sel.ride.tripId)}`, bearer(paxS));
  assert.equal(rideSnap.statusCode, 200, 'owner reads the bootstrapped ride');
  assert.equal(rideSnap.json().ride.status, 'DRIVER_EN_ROUTE');

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
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
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
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
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

// BD-RIDE-SELECT-CONFLICT-RIDE-INVARIANT-01A — the ON CONFLICT (trip_id) DO NOTHING path.
// A pre-existing rides row at the select's tripId must satisfy the FULL direct
// conflict-Ride invariant (domain/select-conflict-ride.js) before it can become this
// selection's ACK; any mismatch throws inside app.db.tx() and rolls back the WHOLE
// selection (accepted offer, rejected peer, assignment, order ACCEPTED) — the conflicting
// Ride itself is never overwritten, cleaned up, or neutralized (rejection + full rollback
// is the whole policy for this slice).
test('select rejects a mismatched conflict Ride (500, full rollback, conflict Ride untouched), then a clean retry succeeds once the stale Ride is removed', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1599${String(process.pid).padStart(7, '0')}`;
  const drvA = `+1600${String(process.pid).padStart(7, '0')}`;
  const drvB = `+1601${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    for (const p of [pax, drvA, drvB]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const paxS = await mintSession(app, pax);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const drvAS = await mintSession(app, drvA);
  const drvBS = await mintSession(app, drvB);
  const offA = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'A', price: 800 }, bearer(drvAS))).json().offer;
  const offB = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'B', price: 900 }, bearer(drvBS))).json().offer;

  const tripId = `trip_${order.id}`;
  const orderRow = (await cleanup.query('SELECT id FROM orders WHERE legacy_id = $1', [order.id])).rows[0];
  // Fabricate a conflicting rides row BEFORE select ever runs, so bootstrapRide()'s
  // ON CONFLICT DO NOTHING fires and forces the conflict-reread path. A mismatched
  // passenger_name and a null driver_user_id are enough to fail the invariant.
  await cleanup.query(
    `INSERT INTO rides (trip_id, order_id, status, role, driver_user_id, passenger_user_id,
                          passenger_name, accepted_at)
     VALUES ($1, $2, 'DRIVER_EN_ROUTE', 'passenger', NULL, NULL, 'MISMATCHED', now())`,
    [tripId, orderRow.id],
  );

  const sel = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offA.driverId }, bearer(paxS));
  assert.equal(sel.statusCode, 500, 'a mismatched conflict Ride is a non-2xx internal invariant failure, never a silent 200');
  assert.equal(sel.json().code, 'INTERNAL');
  assert.equal(sel.json().retryable, true, 'the generic 5xx problem shape marks it retryable');

  // Full rollback: neither offer changed, no assignment row, order still CREATED.
  const offerRows = (await cleanup.query('SELECT legacy_id, status FROM offers WHERE order_id = $1', [orderRow.id])).rows;
  assert.equal(offerRows.find((o) => o.legacy_id === offA.id).status, 'sent', 'target offer was NOT accepted (rolled back)');
  assert.equal(offerRows.find((o) => o.legacy_id === offB.id).status, 'sent', 'peer offer was NOT rejected (rolled back)');
  const assignmentRows = (await cleanup.query('SELECT * FROM assignment WHERE order_id = $1', [orderRow.id])).rows;
  assert.equal(assignmentRows.length, 0, 'no assignment row was created');
  const orderStatusRow = (await cleanup.query('SELECT status FROM orders WHERE id = $1', [orderRow.id])).rows[0];
  assert.equal(orderStatusRow.status, 'CREATED', 'order was NOT flipped to ACCEPTED');

  // The conflicting Ride itself is untouched — not overwritten, repaired, or neutralized.
  const conflictRow = (await cleanup.query('SELECT passenger_name, driver_user_id FROM rides WHERE trip_id = $1', [tripId])).rows[0];
  assert.equal(conflictRow.passenger_name, 'MISMATCHED', 'the conflicting Ride was not overwritten');
  assert.equal(conflictRow.driver_user_id, null, 'the conflicting Ride was not silently patched');

  // Remove ONLY the fabricated conflict Ride, then retry — a clean select must now succeed.
  await cleanup.query('DELETE FROM rides WHERE trip_id = $1', [tripId]);
  const retry = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offA.driverId }, bearer(paxS));
  assert.equal(retry.statusCode, 200, 'after removing the stale conflict Ride, a fresh selection succeeds');
  const retryBody = retry.json();
  assert.equal(retryBody.ride.tripId, tripId);
  assert.equal(retryBody.ride.status, 'DRIVER_EN_ROUTE');
  assert.equal(retryBody.order.status, 'ACCEPTED');
});

// Concurrency guarantee: the conflict-Ride reread's SELECT ... FOR UPDATE (rides.
// lockRideByTripId, the SAME primitive PATCH /ride-state/rides/:tripId/status also takes)
// must genuinely serialize against a concurrent participant status transition on the same
// row — the transition cannot commit while the holder still has the lock. Exercised
// directly at the row-lock primitive (two raw pg connections) rather than through the full
// HTTP /select round trip, so the barrier is deterministic: a bounded poll of
// pg_stat_activity observes the second connection's backend genuinely blocked
// (wait_event_type = 'Lock') before the first releases — never a fixed sleep.
test('conflict-Ride row lock serializes against a concurrent participant status transition (deterministic barrier, no sleep)', { skip: SKIP }, async (t) => {
  const tripId = `trip_conflict-lock-${process.pid}-${Date.now()}`;
  const setup = new pg.Client({ connectionString: DATABASE_URL });
  const holder = new pg.Client({ connectionString: DATABASE_URL }); // simulates the select tx's conflict reread
  const waiter = new pg.Client({ connectionString: DATABASE_URL }); // simulates a concurrent PATCH status transition
  const monitor = new pg.Client({ connectionString: DATABASE_URL }); // observes pg_stat_activity — never asserts by sleeping

  t.after(async () => {
    await holder.query('ROLLBACK').catch(() => {});
    await waiter.query('ROLLBACK').catch(() => {});
    await holder.end().catch(() => {});
    await waiter.end().catch(() => {});
    await monitor.end().catch(() => {});
    await setup.query('DELETE FROM rides WHERE trip_id = $1', [tripId]).catch(() => {});
    await setup.end().catch(() => {});
  });

  await setup.connect();
  await setup.query(`INSERT INTO rides (trip_id, status, role) VALUES ($1, 'DRIVER_EN_ROUTE', 'passenger')`, [tripId]);
  await holder.connect();
  await waiter.connect();
  await monitor.connect();

  await holder.query('BEGIN');
  const holderRow = (await holder.query('SELECT * FROM rides WHERE trip_id = $1 FOR UPDATE', [tripId])).rows[0];
  assert.equal(holderRow.trip_id, tripId, 'the holder (select-tx conflict reread) acquires the row lock');

  await waiter.query('BEGIN');
  const waiterPromise = waiter.query('SELECT * FROM rides WHERE trip_id = $1 FOR UPDATE', [tripId]);

  // Deterministic barrier: poll pg_stat_activity for the waiter's own backend PID until it
  // reports genuinely waiting on a lock. Bounded, but never a fixed-duration sleep-and-hope.
  const deadline = Date.now() + 5000;
  let observedBlocked = false;
  while (Date.now() < deadline) {
    const { rows } = await monitor.query(
      'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
      [waiter.processID],
    );
    if (rows[0]?.wait_event_type === 'Lock') { observedBlocked = true; break; }
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(observedBlocked, 'the concurrent status-transition query is genuinely blocked on the conflict-Ride row lock');

  let waiterSettled = false;
  waiterPromise.then(() => { waiterSettled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waiterSettled, false, 'the blocked participant transition has not proceeded while the holder still has the lock');

  // Release the holder (mirrors the select transaction's ROLLBACK on an invariant failure) —
  // the waiter must then proceed against the ORIGINAL, unmodified row.
  await holder.query('ROLLBACK');
  const waiterResult = await waiterPromise;
  assert.equal(waiterResult.rows[0].trip_id, tripId, 'after the holder releases, the blocked transaction proceeds against the original Ride');
  assert.equal(waiterResult.rows[0].status, 'DRIVER_EN_ROUTE', 'the original Ride was not changed while the lock was held');
  await waiter.query('ROLLBACK');
});
