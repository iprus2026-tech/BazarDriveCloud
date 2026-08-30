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
import { lockConflictRideForSelection, lockRideByTripId } from '../src/repositories/rides.js';
import { validateConflictRideInvariant } from '../src/domain/select-conflict-ride.js';

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

// BD-RIDE-SELECT-CONFLICT-RIDE-PG-PRECISION-01B — lockConflictRideForSelection derives its
// four timestamp facts entirely inside PostgreSQL, at full native `timestamptz` precision.
// Exercised directly against the repository function + the pure validator (not through the
// full HTTP /select round trip) so every scenario is fully deterministic: each order/ride
// pair's timestamps are literal, hand-chosen values under complete control, never derived
// from the wall clock at test-execution time — two SEPARATE round-trip queries cannot be
// relied on to land inside the same millisecond of real time, so a live-clock version of
// this test would be inherently flaky. node-postgres still parses every returned
// `timestamptz` into a millisecond-resolution JS Date (asserted below too) — exactly the
// precision loss the PostgreSQL-native facts below must not inherit.
test('lockConflictRideForSelection: PostgreSQL-native facts hold at true microsecond precision (exact match / same-millisecond distinct microseconds / both chronology violations / missing accepted_at)', { skip: SKIP }, async (t) => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  const tripIds = [];
  t.after(async () => {
    if (tripIds.length) await client.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    await client.query("DELETE FROM orders WHERE legacy_id LIKE $1", [`order-pg-precision-%-${process.pid}`]).catch(() => {});
    await client.end();
  });

  const baseSeed = {
    status: 'DRIVER_EN_ROUTE', role: 'passenger',
    driverUserId: null, passengerUserId: null, passengerName: null, passengerInitials: null,
    passengerPhoneMasked: null, passengerNote: null, driverName: null, driverCar: null,
    driverRating: null, routePickupLabel: null, routeDropoffLabel: null,
    orderOfferPrice: null, ridePrice: null,
  };

  // One order + one conflicting ride per scenario, with fully-controlled literal timestamps
  // and every OTHER field matching, so only the timestamp facts can move the verdict.
  async function scenario(name, { orderAcceptedAt, rideCreatedAt, rideAcceptedAt, rideUpdatedAt }) {
    const legacyId = `order-pg-precision-${name}-${process.pid}`;
    const tripId = `trip_${legacyId}`;
    tripIds.push(tripId);
    const orderRow = (await client.query(
      `INSERT INTO orders (legacy_id, accepted_at) VALUES ($1, $2) RETURNING id`,
      [legacyId, orderAcceptedAt],
    )).rows[0];
    await client.query(
      `INSERT INTO rides (trip_id, order_id, status, role, created_at, accepted_at, updated_at)
       VALUES ($1, $2, 'DRIVER_EN_ROUTE', 'passenger', $3, $4, $5)`,
      [tripId, orderRow.id, rideCreatedAt, rideAcceptedAt, rideUpdatedAt],
    );
    return { tripId, orderId: orderRow.id, seed: { ...baseSeed, tripId, orderId: orderRow.id } };
  }

  // 1) exact same timestamp — PASS.
  {
    const t0 = '2026-08-30 10:00:00.123456+00';
    const { tripId, orderId, seed } = await scenario('exact', {
      orderAcceptedAt: t0, rideCreatedAt: t0, rideAcceptedAt: t0, rideUpdatedAt: t0,
    });
    const row = await lockConflictRideForSelection(client, { tripId, orderId });
    assert.equal(row.pg_has_core_timestamps, true, 'exact match: all core timestamps present');
    assert.equal(row.pg_accepted_at_matches_order, true, 'exact match: accepted_at equals orders.accepted_at');
    assert.equal(row.pg_created_le_accepted, true, 'exact match: created_at <= accepted_at');
    assert.equal(row.pg_accepted_le_updated, true, 'exact match: accepted_at <= updated_at');
    assert.deepEqual(validateConflictRideInvariant({ ride: row, seed }), { ok: true, reason: null });
  }

  // 2) distinct microseconds within the SAME millisecond — equality flag false, validator FAIL.
  {
    const orderT = '2026-08-30 10:00:00.123400+00';
    const rideT = '2026-08-30 10:00:00.123900+00'; // same millisecond (123), different microsecond
    const { tripId, orderId, seed } = await scenario('same-ms', {
      orderAcceptedAt: orderT, rideCreatedAt: rideT, rideAcceptedAt: rideT, rideUpdatedAt: rideT,
    });
    const row = await lockConflictRideForSelection(client, { tripId, orderId });
    assert.equal(row.accepted_at.getTime(), row.created_at.getTime(), 'node-pg Date truncates both literals to the identical millisecond');
    assert.equal(row.pg_accepted_at_matches_order, false, 'PostgreSQL itself still distinguishes the two microsecond-different instants');
    assert.deepEqual(validateConflictRideInvariant({ ride: row, seed }), { ok: false, reason: 'accepted_at_matches_order' });
  }

  // 3) created_at > accepted_at by ONLY microseconds (same millisecond) — chronology FAIL.
  {
    const early = '2026-08-30 10:00:00.500000+00';
    const late = '2026-08-30 10:00:00.500001+00'; // 1 microsecond later, same millisecond
    const { tripId, orderId, seed } = await scenario('created-after-accepted', {
      orderAcceptedAt: early, rideCreatedAt: late, rideAcceptedAt: early, rideUpdatedAt: late,
    });
    const row = await lockConflictRideForSelection(client, { tripId, orderId });
    assert.equal(row.created_at.getTime(), row.accepted_at.getTime(), 'both truncate to the identical millisecond in JS');
    assert.equal(row.pg_created_le_accepted, false, 'PostgreSQL sees created_at as genuinely LATER than accepted_at');
    assert.deepEqual(validateConflictRideInvariant({ ride: row, seed }), { ok: false, reason: 'created_at<=accepted_at' });
  }

  // 4) accepted_at > updated_at by ONLY microseconds (same millisecond) — chronology FAIL.
  {
    const early = '2026-08-30 10:00:00.700000+00';
    const late = '2026-08-30 10:00:00.700001+00';
    const { tripId, orderId, seed } = await scenario('accepted-after-updated', {
      orderAcceptedAt: late, rideCreatedAt: early, rideAcceptedAt: late, rideUpdatedAt: early,
    });
    const row = await lockConflictRideForSelection(client, { tripId, orderId });
    assert.equal(row.accepted_at.getTime(), row.updated_at.getTime(), 'both truncate to the identical millisecond in JS');
    assert.equal(row.pg_accepted_le_updated, false, 'PostgreSQL sees accepted_at as genuinely LATER than updated_at');
    assert.deepEqual(validateConflictRideInvariant({ ride: row, seed }), { ok: false, reason: 'accepted_at<=updated_at' });
  }

  // 5) missing accepted_at — presence flag FAIL (a NULL comparison is SQL NULL, not false, and
  // still fails closed with no special-casing needed).
  {
    const t0 = '2026-08-30 10:00:00.000000+00';
    const { tripId, orderId, seed } = await scenario('missing-accepted', {
      orderAcceptedAt: t0, rideCreatedAt: t0, rideAcceptedAt: null, rideUpdatedAt: t0,
    });
    const row = await lockConflictRideForSelection(client, { tripId, orderId });
    assert.equal(row.pg_has_core_timestamps, false, 'a NULL accepted_at fails the presence fact');
    assert.equal(row.pg_created_le_accepted, null, 'the chronology comparison against a NULL accepted_at is SQL NULL, not false');
    assert.deepEqual(validateConflictRideInvariant({ ride: row, seed }), { ok: false, reason: 'missing_core_timestamps' });
  }
});

// Concurrency guarantee: the conflict-Ride reread's SELECT ... FOR UPDATE — now
// rides.lockConflictRideForSelection, the selection-specific seam
// (BD-RIDE-SELECT-CONFLICT-RIDE-PG-PRECISION-01B) — must genuinely serialize against a
// concurrent participant status transition on the same row via rides.lockRideByTripId (the
// SAME primitive PATCH /ride-state/rides/:tripId/status takes; both lock the identical
// physical `rides` row, so the join/extra columns in the selection-specific query do not
// change what is being locked). The transition cannot commit while the holder still has the
// lock. Exercised directly at the two real repository functions (two raw pg connections)
// rather than through the full HTTP /select round trip, so the barrier is deterministic: a
// bounded poll of pg_stat_activity observes the second connection's backend genuinely
// blocked (wait_event_type = 'Lock') before the first releases — never a fixed sleep.
test('conflict-Ride row lock (new selection-specific seam) serializes against a concurrent participant status transition (deterministic barrier, no sleep)', { skip: SKIP }, async (t) => {
  const tripId = `trip_conflict-lock-pg-precision-${process.pid}-${Date.now()}`;
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
    await setup.query("DELETE FROM orders WHERE legacy_id = $1", [`order-conflict-lock-pg-precision-${process.pid}`]).catch(() => {});
    await setup.end().catch(() => {});
  });

  await setup.connect();
  const orderRow = (await setup.query(
    `INSERT INTO orders (legacy_id) VALUES ($1) RETURNING id`,
    [`order-conflict-lock-pg-precision-${process.pid}`],
  )).rows[0];
  await setup.query(
    `INSERT INTO rides (trip_id, order_id, status, role) VALUES ($1, $2, 'DRIVER_EN_ROUTE', 'passenger')`,
    [tripId, orderRow.id],
  );
  await holder.connect();
  await waiter.connect();
  await monitor.connect();

  await holder.query('BEGIN');
  const holderRow = await lockConflictRideForSelection(holder, { tripId, orderId: orderRow.id });
  assert.equal(holderRow.trip_id, tripId, 'the holder (the new selection-specific locked seam) acquires the row lock');

  await waiter.query('BEGIN');
  const waiterPromise = lockRideByTripId(waiter, tripId); // the SAME primitive PATCH /ride-state takes

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
  assert.equal(waiterResult.trip_id, tripId, 'after the holder releases, the blocked transaction proceeds against the original Ride');
  assert.equal(waiterResult.status, 'DRIVER_EN_ROUTE', 'the original Ride was not changed while the lock was held');
  await waiter.query('ROLLBACK');
});
