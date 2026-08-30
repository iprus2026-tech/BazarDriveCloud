// /server/test/select-recovery-linkage-flow.test.mjs — BD-RIDE-SELECT-RECOVERY-LINKAGE-INVARIANT-01A.
// Real-Postgres end-to-end coverage for the recovery gate reinforcing GET /ride-state/rides/:tripId
// and GET /matching/offers?orderId=. SKIPPED without DATABASE_URL; runs in server-ci. The pure
// table-driven coverage for domain/select-recovery-linkage.js itself lives in
// select-recovery-linkage.test.mjs; this file proves the SQL bundle queries, the two reinforced
// HTTP handlers, and cross-cutting properties (candidate-count ambiguity, poisoned-cache
// non-leakage, torn-read freedom) that only a real database can demonstrate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { findRecoveryBundleByTripId, findRecoveryBundleByOrderId } from '../src/repositories/rides.js';

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

// ride_events is append-only (trg_ride_events_no_mutation rejects DELETE; rides<-ride_events is
// ON DELETE RESTRICT), so a ride whose PATCH chokepoint has actually run (appending a
// status_change event) can't be dropped normally — mirrors ride-state-flow.test.mjs's own
// cleanup exactly: briefly disable triggers (CI/local superuser) to drop the test's rows.
async function deleteRidesWithEvents(cleanup, tripIds) {
  if (!tripIds.length) return;
  await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
  await cleanup.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
  await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
  await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
}

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

// Full accept via the real HTTP flow: passenger creates an order, one driver offers, the
// passenger selects them. Returns everything a test needs to poke at raw rows afterward.
async function acceptedFixture(app, cleanup, ns) {
  const pax = `+1700${ns}`;
  const drv = `+1701${ns}`;
  const paxS = await mintSession(app, pax);
  const drvS = await mintSession(app, drv);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  const offer = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'Иван', car: 'Kia Rio', rating: '4,8', price: 800 }, bearer(drvS))).json().offer;
  const sel = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offer.driverId }, bearer(paxS));
  assert.equal(sel.statusCode, 200, 'fixture setup: select must succeed');
  const tripId = sel.json().ride.tripId;
  return { pax, drv, paxS, drvS, order, offer, tripId, driverId: offer.driverId };
}

function makeCleanupClient() {
  return new pg.Client({ connectionString: DATABASE_URL });
}

// serializeOrder() echoes `row.legacy_id ?? row.id` as the API-facing `order.id` — i.e. every
// HTTP response's `order.id` is the LEGACY string, never the internal UUID. Raw SQL against
// rides.order_id/orders.id needs the internal UUID, resolved explicitly here rather than
// reusing the HTTP-facing id by mistake.
async function internalOrderId(client, legacyId) {
  const { rows } = await client.query('SELECT id FROM orders WHERE legacy_id = $1', [legacyId]);
  return rows[0].id;
}

// ── 1) full accept → both GETs pass, reprojected body verified against order/offer ─────────
test('recovery gate: full accept passes on both GETs, Ride response reprojected from order/offer', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}01`;
  const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);

  const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
  assert.equal(rideRes.statusCode, 200, 'recovery gate passes for a fresh coherent accept');
  const ride = rideRes.json().ride;
  assert.equal(ride.driver.name, 'Иван', 'driver.name reprojected from the accepted offer');
  assert.equal(ride.driver.car, 'Kia Rio');
  assert.equal(ride.driver.rating, '4,8');
  assert.equal(ride.route.pickupLabel, 'Дом', 'route reprojected from the order');
  assert.equal(ride.route.dropoffLabel, 'Центр');
  assert.equal(ride.order.offerPrice, '800 ₽', 'fare reprojected from the accepted bid');
  assert.equal(ride.passenger.rating, null, 'no-source field neutral-projected null');
  assert.equal(ride.driver.initials, null, 'no-source field neutral-projected null');
  assert.equal(ride.route.etaToPickup, null);
  assert.match(ride.timestamps.acceptedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'timestamps normalized to the existing public ISO format');

  const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(offersRes.statusCode, 200, 'recovery gate passes on offers-GET too');
  assert.equal(offersRes.json().items.find((o) => o.status === 'accepted').driverName, 'Иван');
});

// ── 2) CREATED order with a raw-inserted recovery footprint forces the gate → 409 ──────────
test('recovery gate: CREATED order with an accepted-offer footprint forces the gate (409), not the plain list', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}02`;
  const pax = `+1700${ns}`;
  const drv = `+1701${ns}`;
  const paxS = await mintSession(app, pax);
  const drvS = await mintSession(app, drv);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'A' }, dropoff: { label: 'B' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const offer = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'X' }, bearer(drvS))).json().offer;

  // Force the offer straight to 'accepted' via raw SQL, WITHOUT going through /select — the
  // order itself stays literally 'CREATED'. No assignment/Ride exists either.
  await cleanup.query('UPDATE offers SET status = $1 WHERE legacy_id = $2', ['accepted', offer.id]);

  const res = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(res.statusCode, 409, 'a recovery footprint forces the gate even while order.status is still literally CREATED');
  assert.equal(res.json().code, 'RIDE_RECOVERY_UNVERIFIED');
  assert.equal(res.json().retryable, false);
});

// ── 3) microsecond-level PostgreSQL-native fact precision — direct repository-function proof ──
test('recovery bundle: PostgreSQL-native facts hold at true microsecond precision, never via JS Date', { skip: SKIP }, async (t) => {
  const client = makeCleanupClient();
  await client.connect();
  const tripIds = [];
  t.after(async () => {
    if (tripIds.length) await client.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    await client.query("DELETE FROM orders WHERE legacy_id LIKE $1", [`order-recovery-precision-%-${process.pid}`]).catch(() => {});
    await client.end();
  });

  let scenarioIndex = 0;
  async function scenario(name, { orderAcceptedAt, rideCreatedAt, rideAcceptedAt, rideUpdatedAt }) {
    scenarioIndex += 1;
    const legacyId = `order-recovery-precision-${name}-${process.pid}`;
    const tripId = `trip_${legacyId}`;
    tripIds.push(tripId);
    // Distinct, correctly-bounded phone numbers (uq_users_phone is a real unique index) —
    // a zero-padded pid + a per-scenario digit, mirroring the pattern already used
    // throughout select-flow.test.mjs, never a name string that could collide after slicing.
    const passenger = (await client.query(
      `INSERT INTO users (phone) VALUES ($1) RETURNING id`, [`+179${scenarioIndex}${String(process.pid).padStart(7, '0')}0`],
    )).rows[0];
    const driver = (await client.query(
      `INSERT INTO users (phone) VALUES ($1) RETURNING id`, [`+179${scenarioIndex}${String(process.pid).padStart(7, '0')}1`],
    )).rows[0];
    const orderRow = (await client.query(
      `INSERT INTO orders (legacy_id, passenger_id, status, accepted_at) VALUES ($1, $2, 'ACCEPTED', $3) RETURNING id`,
      [legacyId, passenger.id, orderAcceptedAt],
    )).rows[0];
    await client.query(
      `INSERT INTO rides (trip_id, order_id, status, role, driver_user_id, passenger_user_id, created_at, accepted_at, updated_at)
       VALUES ($1, $2, 'ACCEPTED', 'passenger', $3, $4, $5, $6, $7)`,
      [tripId, orderRow.id, driver.id, passenger.id, rideCreatedAt, rideAcceptedAt, rideUpdatedAt],
    );
    t.after(async () => {
      await client.query('DELETE FROM users WHERE id = ANY($1)', [[passenger.id, driver.id]]).catch(() => {});
    });
    return { tripId };
  }

  // exact same timestamp — PASS.
  {
    const t0 = '2026-08-30 10:00:00.123456+00';
    const { tripId } = await scenario('exact', { orderAcceptedAt: t0, rideCreatedAt: t0, rideAcceptedAt: t0, rideUpdatedAt: t0 });
    const bundle = await findRecoveryBundleByTripId(client, tripId);
    assert.equal(bundle.pg_has_core_timestamps, true);
    assert.equal(bundle.pg_accepted_at_matches_order, true);
    assert.equal(bundle.pg_chronology_ok, true);
  }

  // distinct microseconds within the SAME millisecond — equality fact false.
  {
    const orderT = '2026-08-30 10:00:00.123400+00';
    const rideT = '2026-08-30 10:00:00.123900+00';
    const { tripId } = await scenario('same-ms', { orderAcceptedAt: orderT, rideCreatedAt: rideT, rideAcceptedAt: rideT, rideUpdatedAt: rideT });
    const bundle = await findRecoveryBundleByTripId(client, tripId);
    assert.equal(new Date(bundle.ride.accepted_at).getTime(), new Date(bundle.order.accepted_at).getTime(), 'node-pg-shaped Date truncates both to the identical millisecond');
    assert.equal(bundle.pg_accepted_at_matches_order, false, 'PostgreSQL itself still distinguishes the two microsecond-different instants');
  }

  // created_at > accepted_at by ONLY microseconds (same millisecond) — chronology false.
  {
    const early = '2026-08-30 10:00:00.500000+00';
    const late = '2026-08-30 10:00:00.500001+00';
    const { tripId } = await scenario('chrono-violation', { orderAcceptedAt: early, rideCreatedAt: late, rideAcceptedAt: early, rideUpdatedAt: late });
    const bundle = await findRecoveryBundleByTripId(client, tripId);
    assert.equal(bundle.pg_chronology_ok, false, 'PostgreSQL sees created_at as genuinely LATER than accepted_at, at microsecond precision');
  }
});

// ── 4) Ride linked via order_id but with a NONCANONICAL trip_id — gate resolves via the FK
//      fallback and fails on trip-linkage, from BOTH entry points ─────────────────────────
test('recovery gate: linked Ride with a noncanonical trip_id is resolved via order_id and fails trip-linkage, from both GETs', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id LIKE $1', ['trip-noncanonical-%']).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}04`;
  const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);

  const noncanonicalTripId = `trip-noncanonical-${process.pid}`;
  await cleanup.query('UPDATE rides SET trip_id = $1 WHERE trip_id = $2', [noncanonicalTripId, tripId]);

  const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(noncanonicalTripId)}`, bearer(paxS));
  assert.equal(rideRes.statusCode, 409, 'ride-state GET resolves the order via ride.order_id and fails on trip-linkage, never bypasses as standalone');

  const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(offersRes.statusCode, 409, 'offers GET resolves the same Ride via order_id and fails identically');
});

// ── 5a) offers-GET side: two distinct Ride candidates for one order → 409, no SQL 500 ───────
test('recovery gate: two distinct Ride candidates for one order (offers-GET) fail closed, no SQL cardinality error', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id LIKE $1', ['trip-ambiguous-%']).catch(() => {});
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}05`;
  const { paxS, order } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);

  // A second, distinct Ride row that ALSO points its order_id at the same order, but under a
  // different, noncanonical trip_id — now two rides both resolve as candidates for this order
  // (one via the canonical trip_<legacy_id> path, one via the order_id FK path).
  const secondTripId = `trip-ambiguous-${process.pid}`;
  const orderUuid = await internalOrderId(cleanup, order.id);
  const rideRow = (await cleanup.query('SELECT driver_user_id, passenger_user_id FROM rides WHERE order_id = $1', [orderUuid])).rows[0];
  await cleanup.query(
    `INSERT INTO rides (trip_id, order_id, status, role, driver_user_id, passenger_user_id)
     VALUES ($1, $2, 'ACCEPTED', 'passenger', $3, $4)`,
    [secondTripId, orderUuid, rideRow.driver_user_id, rideRow.passenger_user_id],
  );

  // Must not throw a raw pg cardinality error — assert a clean HTTP 500-free 409 instead.
  const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(offersRes.statusCode, 409, 'ambiguous Ride candidates fail closed, never a 500');
  assert.equal(offersRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
});

// ── 5b) ride-state-GET side: one Ride whose own two order-resolution paths disagree ─────────
test('recovery gate: one Ride whose canonical-trip and order_id resolutions disagree (ride-state-GET) fails closed, no SQL cardinality error', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const nsX = `${process.pid}5a`;
  const nsY = `${process.pid}5b`;
  const { paxS: paxX, order: orderX, tripId: tripIdX } = await acceptedFixture(app, cleanup, nsX);
  const { order: orderY } = await acceptedFixture(app, cleanup, nsY);
  orderIds.push(orderX.id, orderY.id);

  // Ride R's trip_id still canonically derives orderX (unchanged), but its order_id FK is
  // corrupted to point at orderY instead — the two resolution paths now disagree. paxX is
  // still ride R's genuine passenger_user_id, so the participant auth gate still passes —
  // the ambiguity must be caught by the recovery gate itself, not masked by a 403.
  const orderYUuid = await internalOrderId(cleanup, orderY.id);
  await cleanup.query('UPDATE rides SET order_id = $1 WHERE trip_id = $2', [orderYUuid, tripIdX]);

  const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripIdX)}`, bearer(paxX));
  assert.equal(rideRes.statusCode, 409, 'two disagreeing order candidates for the SAME Ride fail closed, never a 500');
  assert.equal(rideRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
});

// ── 6) non-owner cross-endpoint proof — auth gates run before the recovery gate, unaffected ──
test('recovery gate: non-owner/non-participant cross-endpoint access is still refused (auth runs first)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}06`;
  const { drvS, order, tripId } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);

  // The assigned DRIVER may read ride-state (participant), but is NOT the order owner.
  const driverRide = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(drvS));
  assert.equal(driverRide.statusCode, 200, 'the assigned driver, a genuine participant, still reads ride-state fine');
  const driverOffers = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(drvS));
  assert.equal(driverOffers.statusCode, 403, 'the driver is not the order owner — offers-GET stays 403, unaffected by the recovery gate');

  // A total stranger is neither participant nor owner.
  const strangerS = await mintSession(app, `+1702${ns}`);
  const strangerRide = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(strangerS));
  assert.equal(strangerRide.statusCode, 403, 'a non-participant stranger stays 403 on ride-state-GET');
  const strangerOffers = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(strangerS));
  assert.equal(strangerOffers.statusCode, 403, 'a non-owner stranger stays 403 on offers-GET');
});

// ── 7) poisoned Ride cache never leaks — authoritative reprojection proven under corruption ──
test('recovery gate: a poisoned Ride cache is never served — response is reprojected from order/offer', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}07`;
  const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);

  // Poison only the fields serializeRecoveredRide() reprojects (never compared by the
  // validator) — NOT the always-null columns (passenger_rating/driver_initials), which the
  // validator correctly treats as a genuine corruption signal and would legitimately 409 on
  // (already covered by select-recovery-linkage.test.mjs's "stale_column_populated" cases).
  await cleanup.query(
    `UPDATE rides SET
        passenger_name = 'POISONED-NAME', driver_name = 'POISONED-DRIVER',
        route_pickup_label = 'POISONED-PICKUP', order_offer_price = 'POISONED-PRICE'
      WHERE trip_id = $1`,
    [tripId],
  );

  const res = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
  assert.equal(res.statusCode, 200, 'linkage itself is untouched by the poisoning, so the gate still passes');
  const ride = res.json().ride;
  assert.equal(ride.driver.name, 'Иван', 'served driver.name is the authoritative reprojection, never the poisoned cache');
  assert.equal(ride.route.pickupLabel, 'Дом', 'served route label is reprojected, never the poisoned cache');
  assert.equal(ride.order.offerPrice, '800 ₽', 'served fare is reprojected, never the poisoned cache');
  assert.equal(ride.passenger.rating, null, 'no-source field stays neutral null even though storage was poisoned');
  assert.equal(ride.driver.initials, null, 'no-source field stays neutral null even though storage was poisoned');
  assert.notEqual(ride.passenger.name, 'POISONED-NAME');
});

// ── 8) concurrent writer, no torn bundle — single-statement isolation, no lock needed ───────
test('recovery bundle: a concurrent uncommitted writer never produces a torn read', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const writer = makeCleanupClient();
  const reader = makeCleanupClient();
  const orderIds = [];
  t.after(async () => {
    await writer.query('ROLLBACK').catch(() => {});
    await writer.end().catch(() => {});
    await reader.end().catch(() => {});
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}08`;
  const { order, tripId } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);

  await writer.connect();
  await reader.connect();

  await writer.query('BEGIN');
  await writer.query(`UPDATE rides SET status = 'DRIVER_APPROACHING_PICKUP', approaching_at = now() WHERE trip_id = $1`, [tripId]);
  // Uncommitted — a concurrent reader on a SEPARATE connection must see the PRE-transition state.
  const duringBundle = await findRecoveryBundleByTripId(reader, tripId);
  assert.equal(duringBundle.ride.status, 'DRIVER_EN_ROUTE', 'reader sees the pre-transition status (the /select bootstrap status) while the writer is uncommitted (READ COMMITTED isolation)');
  assert.equal(duringBundle.ride.approaching_at, null, 'no partial view of the uncommitted approaching_at either');

  await writer.query('COMMIT');
  const afterBundle = await findRecoveryBundleByTripId(reader, tripId);
  assert.equal(afterBundle.ride.status, 'DRIVER_APPROACHING_PICKUP', 'after commit, a fresh read sees the fully-updated state');
  assert.ok(afterBundle.ride.approaching_at, 'approaching_at is now populated');
});

// ── 9) genuinely standalone Ride (no order at all) stays outside recovery, unaffected ───────
test('recovery gate: a genuinely standalone Ride (no resolvable order at all) is bypassed, unaffected', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const drv = `+1703${process.pid}`;
  const pax = `+1704${process.pid}`;
  const tripId = `trip-standalone-${process.pid}`;
  t.after(async () => {
    await cleanup.query('DELETE FROM rides WHERE trip_id = $1', [tripId]).catch(() => {});
    for (const p of [drv, pax]) await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
    await cleanup.end();
    await app.close();
  });

  const drvS = await mintSession(app, drv);
  const paxS = await mintSession(app, pax);
  await cleanup.query(
    `INSERT INTO rides (trip_id, status, role, driver_user_id, passenger_user_id, driver_name)
       VALUES ($1, 'ACCEPTED', 'driver', $2, $3, 'Иван')`,
    [tripId, drvS.user.userId, paxS.user.userId],
  );

  const res = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(drvS));
  assert.equal(res.statusCode, 200, 'a Ride with no resolvable order at all (neither canonical trip_id nor order_id) stays outside recovery — the ordinary read is unaffected');
  assert.equal(res.json().ride.driver.name, 'Иван', 'served from the plain, non-reprojected serializeRide() path — unaffected');
});

// ── 11) a physically-populated source-less serializer column fails closed on BOTH GETs ─────
// Real-Postgres complement to select-recovery-linkage.test.mjs's pure "stale_column_populated"
// coverage: proves the corruption is caught end-to-end through the actual HTTP gate (409, no
// authoritative body), not merely at the pure-validator layer.
test('recovery gate: a physically-populated source-less serializer column fails closed (409) on both GETs, never an authoritative body', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const ALWAYS_NULL_COLUMNS = ['passenger_rating', 'driver_initials', 'route_eta_to_pickup', 'route_eta_to_destination'];
  for (const [i, col] of ALWAYS_NULL_COLUMNS.entries()) {
    const ns = `${process.pid}11${i}`;
    const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);

    // These columns have NO backing order/offer source at all — bootstrapRide() never sets
    // them and no other write path ever touches them, so a non-null value here can only be
    // corruption/legacy drift, never a legitimate business fact.
    await cleanup.query(`UPDATE rides SET ${col} = $1 WHERE trip_id = $2`, ['stale-value', tripId]);

    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 409, `ride-state-GET fails closed when ${col} is physically populated`);
    assert.equal(rideRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
    assert.equal(rideRes.json().retryable, false);
    assert.equal(rideRes.json().ride, undefined, 'no authoritative ride body on failure');

    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    assert.equal(offersRes.statusCode, 409, `offers-GET fails closed when ${col} is physically populated`);
    assert.equal(offersRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
    assert.equal(offersRes.json().retryable, false);
    assert.equal(offersRes.json().items, undefined, 'no authoritative items body on failure');
  }
});

// ── 12) real direct/sparse transitions from DRIVER_EN_ROUTE via the actual PATCH chokepoint —
// both recovery GETs still pass (Codex finding #1) ──────────────────────────────────────────
test('recovery gate: real DRIVER_EN_ROUTE PATCH transitions (including sparse IN_PROGRESS/COMPLETED) still pass both GETs', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  const tripIds = [];
  t.after(async () => {
    await deleteRidesWithEvents(cleanup, tripIds);
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    await cleanup.end();
    await app.close();
  });

  const targets = ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'];
  for (const [i, target] of targets.entries()) {
    const ns = `${process.pid}12${i}`;
    const { paxS, drvS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);
    tripIds.push(tripId);

    const patchRes = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status: target }, bearer(drvS));
    assert.equal(patchRes.statusCode, 200, `PATCH DRIVER_EN_ROUTE -> ${target} is permitted by the API today (no sequential-progression gate)`);

    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 200, `recovery ride-state GET passes for the real, API-committed sparse ${target} shape`);
    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    assert.equal(offersRes.statusCode, 200, `recovery offers GET passes for the real, API-committed sparse ${target} shape`);
  }
});

// ── 13) real backward non-terminal transition via the actual PATCH chokepoint — still passes ──
test('recovery gate: a real backward non-terminal PATCH transition (WAITING_PASSENGER -> DRIVER_EN_ROUTE) still passes both GETs', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  const tripIds = [];
  t.after(async () => {
    await deleteRidesWithEvents(cleanup, tripIds);
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}13`;
  const { paxS, drvS, order, tripId } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);
  tripIds.push(tripId);

  const forward = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status: 'WAITING_PASSENGER' }, bearer(drvS));
  assert.equal(forward.statusCode, 200);
  const backward = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status: 'DRIVER_EN_ROUTE' }, bearer(drvS));
  assert.equal(backward.statusCode, 200, 'the PATCH chokepoint permits a backward non-terminal transition too');

  const row = (await cleanup.query('SELECT status, approaching_at, arrived_at FROM rides WHERE trip_id=$1', [tripId])).rows[0];
  assert.equal(row.status, 'DRIVER_EN_ROUTE');
  // Only arrived_at is stamped — DRIVER_EN_ROUTE -> WAITING_PASSENGER was a direct skip, so
  // approaching_at (DRIVER_APPROACHING_PICKUP's own column) was never touched, exactly the
  // sparse behavior this whole fix is about.
  assert.ok(row.arrived_at, 'the later-stage timestamp actually stamped stays populated after the status regresses');

  const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
  assert.equal(rideRes.statusCode, 200, 'recovery ride-state GET passes for the real backward-transition shape');
  const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(offersRes.statusCode, 200, 'recovery offers GET passes for the real backward-transition shape');
});

// ── 14) missing current-status timestamp and a broken PostgreSQL chronology still 409 ──────
test('recovery gate: missing current-status timestamp and broken PostgreSQL chronology still fail closed (409)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  // Missing current-status timestamp: a fresh DRIVER_EN_ROUTE accept with accepted_at nulled.
  {
    const ns = `${process.pid}14a`;
    const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);
    await cleanup.query('UPDATE rides SET accepted_at = NULL WHERE trip_id = $1', [tripId]);
    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 409, 'missing accepted_at (the current status DRIVER_EN_ROUTE\'s own timestamp) still fails closed');
    assert.equal(rideRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
  }

  // Broken chronology: accepted_at forced BEFORE created_at (pg_chronology_ok must catch it) —
  // orders.accepted_at is moved to the SAME instant so pg_accepted_at_matches_order stays
  // true and the failure is isolated to chronology specifically. NOTE: rides.updated_at
  // cannot be used for this — trg_rides_updated_at (a BEFORE UPDATE trigger) unconditionally
  // reassigns NEW.updated_at := now() on every UPDATE, silently overriding any explicit value.
  {
    const ns = `${process.pid}14b`;
    const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);
    const orderUuid = await internalOrderId(cleanup, order.id);
    await cleanup.query(`UPDATE rides SET accepted_at = created_at - interval '1 second' WHERE trip_id = $1`, [tripId]);
    await cleanup.query(`UPDATE orders SET accepted_at = (SELECT accepted_at FROM rides WHERE trip_id = $1) WHERE id = $2`, [tripId, orderUuid]);
    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 409, 'accepted_at earlier than created_at violates pg_chronology_ok and still fails closed');
    assert.equal(rideRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
  }
});

// ── 15) real CANCELED cancel-actor matrix — every schema-valid actor passes both GETs ───────
// An invalid actor cannot be tested via real Postgres at all: rides.cancel_by's CHECK
// constraint (migrations/0001) rejects any value outside driver/passenger/system/NULL at
// INSERT/UPDATE time — the DB itself is the enforcement layer for that case, already proven
// unreachable-by-corruption; the "invalid actor" negative case is covered purely at
// select-recovery-linkage.test.mjs's validator level (a defense-in-depth check the DB also
// happens to back).
test('recovery gate: every schema-valid CANCELED cancel_by actor passes both GETs (legacy-import shape)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) {
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [orderIds.map((id) => `trip_${id}`)]).catch(() => {});
      await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const cases = [
    ['driver', 'passenger changed plans'],
    ['passenger', 'changed plans'],
    ['system', null],
    [null, null],
  ];
  for (const [i, [actor, reason]] of cases.entries()) {
    const ns = `${process.pid}15${i}`;
    const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);
    await cleanup.query(
      `UPDATE rides SET status='CANCELED', canceled_at=now(), cancel_by=$1, cancel_reason=$2 WHERE trip_id=$3`,
      [actor, reason, tripId],
    );

    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 200, `CANCELED with cancel_by=${actor} passes ride-state-GET`);
    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    assert.equal(offersRes.statusCode, 200, `CANCELED with cancel_by=${actor} passes offers-GET`);
  }
});
