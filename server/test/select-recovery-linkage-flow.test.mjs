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
import { listOffersByOrder } from '../src/repositories/offers.js';

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

// ── 16) finding #4 regression proof — chain A (revisit a stage already stamped once) and
// chain B (revisit a stage stamped for the FIRST time only AFTER a LATER stage) both pass both
// GETs. Chain B is the exact reproduction that showed the old positional-chain chronology check
// was wrong: DRIVER_EN_ROUTE -> WAITING_PASSENGER stamps arrived_at (skipping approaching_at),
// then EN_ROUTE -> APPROACHING_PICKUP stamps approaching_at for the first time, LATER than the
// still-populated arrived_at — a legitimate, API-committed sequence the old design rejected.
test('recovery gate: chain A and chain B (backward-revisit sequences) both pass both GETs (Codex finding #4)', { skip: SKIP }, async (t) => {
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

  async function runChain(label, ns, statuses) {
    const { paxS, drvS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);
    tripIds.push(tripId);
    for (const status of statuses) {
      const res = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status }, bearer(drvS));
      assert.equal(res.statusCode, 200, `chain ${label}: PATCH -> ${status} succeeds`);
    }
    const bundle = await findRecoveryBundleByTripId(cleanup, tripId);
    assert.equal(bundle.pg_chronology_ok, true, `chain ${label}: pg_chronology_ok holds under the per-column bound design`);
    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 200, `chain ${label}: recovery ride-state GET passes`);
    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    assert.equal(offersRes.statusCode, 200, `chain ${label}: recovery offers GET passes`);
  }

  // A: approaching_at already stamped once, later revisited after a backward hop.
  await runChain('A', `${process.pid}16a`, [
    'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP',
  ]);

  // B: approaching_at is stamped for the FIRST time only after arrived_at was already set.
  await runChain('B', `${process.pid}16b`, [
    'WAITING_PASSENGER', 'DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP',
  ]);
});

// ── 17) finding #4: an optional lifecycle timestamp BEFORE created_at fails closed (409) ────
// Reachable via a normal UPDATE — trg_rides_updated_at only forces updated_at, never the
// target column, so pushing a column earlier than created_at is directly constructible.
test('recovery gate: an optional lifecycle timestamp before created_at fails closed (409) via pg_chronology_ok', { skip: SKIP }, async (t) => {
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

  const OPTIONAL_COLUMNS = ['approaching_at', 'arrived_at', 'started_at', 'completed_at', 'canceled_at'];
  for (const [i, col] of OPTIONAL_COLUMNS.entries()) {
    const ns = `${process.pid}17${i}`;
    const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);
    await cleanup.query(`UPDATE rides SET ${col} = created_at - interval '1 second' WHERE trip_id = $1`, [tripId]);

    const bundle = await findRecoveryBundleByTripId(cleanup, tripId);
    assert.equal(bundle.pg_chronology_ok, false, `${col} before created_at trips pg_chronology_ok`);

    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 409, `${col} before created_at fails ride-state-GET`);
    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    assert.equal(offersRes.statusCode, 409, `${col} before created_at fails offers-GET`);
  }
});

// ── 18) finding #4: an optional lifecycle timestamp AFTER updated_at fails closed (409) ─────
// NOT reachable via UPDATE (trg_rides_updated_at unconditionally reassigns NEW.updated_at :=
// now() on every UPDATE, defeating any attempt to push a column past it that way) — constructed
// via a raw INSERT instead, mirroring the microsecond-precision scenario helper above.
test('recovery gate: an optional lifecycle timestamp after updated_at fails closed via pg_chronology_ok', { skip: SKIP }, async (t) => {
  const client = makeCleanupClient();
  await client.connect();
  const tripIds = [];
  t.after(async () => {
    if (tripIds.length) await client.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    await client.query('DELETE FROM orders WHERE legacy_id LIKE $1', [`order-recovery-afterbound-%-${process.pid}`]).catch(() => {});
    await client.end();
  });

  const OPTIONAL_COLUMNS = ['approaching_at', 'arrived_at', 'started_at', 'completed_at', 'canceled_at'];
  for (const [i, col] of OPTIONAL_COLUMNS.entries()) {
    const legacyId = `order-recovery-afterbound-${col}-${process.pid}`;
    const tripId = `trip_${legacyId}`;
    tripIds.push(tripId);
    const passenger = (await client.query(`INSERT INTO users (phone) VALUES ($1) RETURNING id`, [`+178${i}${String(process.pid).padStart(7, '0')}0`])).rows[0];
    const driver = (await client.query(`INSERT INTO users (phone) VALUES ($1) RETURNING id`, [`+178${i}${String(process.pid).padStart(7, '0')}1`])).rows[0];
    t.after(async () => {
      await client.query('DELETE FROM users WHERE id = ANY($1)', [[passenger.id, driver.id]]).catch(() => {});
    });
    const t0 = '2026-08-30 10:00:00+00';
    const tAfter = '2026-08-30 12:00:00+00'; // strictly after updated_at (=t0)
    const orderRow = (await client.query(
      `INSERT INTO orders (legacy_id, passenger_id, status, accepted_at) VALUES ($1, $2, 'ACCEPTED', $3) RETURNING id`,
      [legacyId, passenger.id, t0],
    )).rows[0];
    const cols = { approaching_at: null, arrived_at: null, started_at: null, completed_at: null, canceled_at: null };
    cols[col] = tAfter;
    await client.query(
      `INSERT INTO rides (trip_id, order_id, status, role, driver_user_id, passenger_user_id,
                           created_at, accepted_at, updated_at,
                           approaching_at, arrived_at, started_at, completed_at, canceled_at)
       VALUES ($1,$2,'ACCEPTED','passenger',$3,$4,$5,$5,$5,$6,$7,$8,$9,$10)`,
      [tripId, orderRow.id, driver.id, passenger.id, t0,
        cols.approaching_at, cols.arrived_at, cols.started_at, cols.completed_at, cols.canceled_at],
    );

    const bundle = await findRecoveryBundleByTripId(client, tripId);
    assert.equal(bundle.pg_chronology_ok, false, `${col} after updated_at trips pg_chronology_ok`);
  }
});

// ── 19) finding #5 fix-proof: a noncanonical trip_id whose stripped remainder coincidentally
// equals an UNRELATED order's legacy_id must NOT be treated as linked — regexp_replace on a
// string with no 'trip_' prefix returns it UNCHANGED (no match, no substitution), so without the
// `r.trip_id ~ '^trip_'` guard the join would falsely report candidate_order_count=1 for a
// genuinely standalone Ride, turning the intended zero-candidate bypass into an incorrect 409.
test('recovery gate: a noncanonical trip_id coincidentally colliding with an unrelated legacy_id stays standalone (finding #5 fix)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const legacyIds = [];
  const tripIds = [];
  t.after(async () => {
    if (tripIds.length) await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    if (legacyIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [legacyIds]).catch(() => {});
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}19`;
  const collisionId = `collision-${ns}`;
  legacyIds.push(collisionId);

  const drvS = await mintSession(app, `+1707${ns}`);
  const paxS = await mintSession(app, `+1708${ns}`);

  // An UNRELATED order whose legacy_id happens to equal the noncanonical Ride's trip_id verbatim.
  await cleanup.query(
    `INSERT INTO orders (legacy_id, passenger_id, status) VALUES ($1, $2, 'CREATED')`,
    [collisionId, paxS.user.userId],
  );

  // A genuinely standalone Ride (no order_id FK at all) whose noncanonical trip_id IS that
  // exact collision string.
  tripIds.push(collisionId);
  await cleanup.query(
    `INSERT INTO rides (trip_id, status, role, driver_user_id, passenger_user_id, driver_name)
       VALUES ($1, 'ACCEPTED', 'driver', $2, $3, 'Standalone')`,
    [collisionId, drvS.user.userId, paxS.user.userId],
  );

  const bundle = await findRecoveryBundleByTripId(cleanup, collisionId);
  assert.equal(bundle.candidate_order_count, 0, 'the collision is not a real trip_ prefix match — candidate_order_count stays 0');

  const res = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(collisionId)}`, bearer(drvS));
  assert.equal(res.statusCode, 200, 'the genuinely standalone Ride is bypassed, unaffected by the coincidental legacy_id collision');
});

// ── 20) finding #7 fix-proof: a self-selected bundle (driver_user_id === passenger_user_id)
// fails closed (409) on both GETs — mirrors the live write-path guards (CANNOT_OFFER_OWN_ORDER,
// CANNOT_SELECT_SELF), extended to recovery for legacy/imported rows.
test('recovery gate: a self-selected bundle (driver === passenger) fails closed (409) on both GETs (Codex finding #7)', { skip: SKIP }, async (t) => {
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

  const ns = `${process.pid}20`;
  const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
  orderIds.push(order.id);

  // Corrupt the bundle so the accepted driver IS the order's own passenger — same identity,
  // consistent across offer/assignment/ride, exactly what a legacy/imported self-offer could
  // produce.
  const orderUuid = await internalOrderId(cleanup, order.id);
  const passengerUserId = (await cleanup.query('SELECT passenger_id FROM orders WHERE id = $1', [orderUuid])).rows[0].passenger_id;
  await cleanup.query(`UPDATE offers SET driver_id = $1 WHERE order_id = $2 AND status = 'accepted'`, [passengerUserId, orderUuid]);
  await cleanup.query('UPDATE assignment SET selected_driver_id = $1 WHERE order_id = $2', [passengerUserId, orderUuid]);
  await cleanup.query('UPDATE rides SET driver_user_id = $1 WHERE trip_id = $2', [passengerUserId, tripId]);

  const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
  assert.equal(rideRes.statusCode, 409, 'a self-selected driver===passenger bundle fails ride-state-GET');
  assert.equal(rideRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
  const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(offersRes.statusCode, 409, 'a self-selected driver===passenger bundle fails offers-GET');
});

// ── 21) finding #8 fix-proof: every terminal-timestamp contradiction fails closed (409) on
// both GETs — completed_at/canceled_at are permanent, one-way locks (the terminal-freeze
// trigger), so unlike the 5 revisitable intermediate stage columns, these two specifically can
// never legitimately coexist with a mismatched current status.
test('recovery gate: every terminal-timestamp contradiction fails closed (409) on both GETs (Codex finding #8)', { skip: SKIP }, async (t) => {
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

  const cases = [
    ['COMPLETED', 'canceled_at'],
    ['CANCELED', 'completed_at'],
    ['NO_SHOW', 'completed_at'],
    ['IN_PROGRESS', 'completed_at'],
  ];
  for (const [i, [status, extraCol]] of cases.entries()) {
    const ns = `${process.pid}21${i}`;
    const { paxS, drvS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);
    tripIds.push(tripId);

    if (status === 'NO_SHOW') {
      // NO_SHOW's own contract requires cancel_by/cancel_reason too — set the exact
      // server-derived shape so the ONLY incoherence introduced is the extra completed_at.
      await cleanup.query(
        `UPDATE rides SET status='NO_SHOW', canceled_at=now(), cancel_by='driver', cancel_reason='passenger_no_show', completed_at=now() WHERE trip_id=$1`,
        [tripId],
      );
    } else {
      // COMPLETED / CANCELED / IN_PROGRESS via the real PATCH chokepoint, then corrupt with
      // the extra terminal column directly (the PATCH itself only ever stamps its own column).
      const res = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status }, bearer(drvS));
      assert.equal(res.statusCode, 200, `PATCH -> ${status} succeeds`);
      await cleanup.query(`UPDATE rides SET ${extraCol} = now() WHERE trip_id = $1`, [tripId]);
    }

    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 409, `${status} with ${extraCol} also populated fails ride-state-GET`);
    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    assert.equal(offersRes.statusCode, 409, `${status} with ${extraCol} also populated fails offers-GET`);
  }
});

// ── 22) finding A fix-proof: the CREATED/no-footprint offers-GET bypass serves the EXACT bundle
// snapshot that formed the decision — never a second, later listOffersByOrder() read — closing
// the TOCTOU between the bypass decision and its response payload. Deterministic, no sleep: we
// intercept app.db.query (the plain single-statement seam GET /offers uses — /select's own
// writes run through a SEPARATE raw pg.Client obtained via app.db.tx(), so this interception
// never touches /select's transaction at all) and hold the bundle statement's ALREADY-FETCHED
// result back from the handler until we explicitly release it, with a real /select commit
// forced into the gap in between.
test('recovery gate: offers-GET bypass serves its own bundle snapshot, never a later listOffersByOrder race (Codex Finding A)', { skip: SKIP }, async (t) => {
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

  const ns = `${process.pid}22`;
  const paxS = await mintSession(app, `+1709${ns}`);
  const drvS = await mintSession(app, `+1710${ns}`);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'A' }, dropoff: { label: 'B' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const offer = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'Racer' }, bearer(drvS))).json().offer;

  // Intercept ONLY the bundle statement (its SQL is uniquely identifiable by its `candidate_rides`
  // CTE name, distinct from findRecoveryBundleByTripId's `candidate_orders`). The REAL query still
  // runs and its REAL (pre-select) result is captured immediately — we only delay handing that
  // already-fetched result back to the caller, via an explicitly awaited release signal.
  const originalQuery = app.db.query;
  let captureResolve;
  const captured = new Promise((resolve) => { captureResolve = resolve; });
  let releaseResolve;
  const released = new Promise((resolve) => { releaseResolve = resolve; });
  let intercepted = false;
  app.db.query = async (text, params) => {
    const result = await originalQuery(text, params);
    if (!intercepted && typeof text === 'string' && text.includes('candidate_rides')) {
      intercepted = true;
      captureResolve();
      await released;
    }
    return result;
  };

  // try/finally guarantees the monkey-patch is restored and the interceptor is released EVEN IF
  // an assertion throws mid-sequence — confirmed necessary via a dedicated failure-path probe: a
  // bare sequential release+restore (no finally) left app.db.query permanently monkey-patched and
  // the held GET's promise permanently pending on a thrown assertion (app.close() itself did not
  // hang, but the dangling promise and un-restored patch are a genuine cleanup gap on this path).
  let heldGet;
  try {
    heldGet = get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    await captured; // the bundle statement has already executed and returned its CREATED/sent snapshot — held back from the handler

    const selectRes = await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: offer.driverId }, bearer(paxS));
    assert.equal(selectRes.statusCode, 200, '/select commits fully while the held GET is still holding its captured pre-select bundle');

    releaseResolve(); // let the held GET continue with the snapshot it already captured
    const firstRes = await heldGet;

    assert.equal(firstRes.statusCode, 200, 'the held GET, using its captured snapshot, still returns 200 (the bypass it already decided on)');
    const firstItems = firstRes.json().items;
    assert.equal(firstItems.length, 1);
    assert.equal(firstItems[0].status, 'sent', 'the held GET serves its CAPTURED pre-select snapshot ("sent"), never a later, post-commit re-read ("accepted")');
    assert.match(firstItems[0].createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'bundle-sourced timestamps are re-normalized to the existing public ISO format');
    assert.match(firstItems[0].expiresAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const secondRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
    assert.equal(secondRes.statusCode, 200, 'a FRESH GET after the commit re-reads a fresh bundle and passes full invariant validation');
    const acceptedItem = secondRes.json().items.find((o) => o.status === 'accepted');
    assert.ok(acceptedItem, 'the fresh GET reflects the now-committed accepted offer, validated by validateRecoveryLinkage()');
    assert.match(acceptedItem.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'the validated-path response keeps its existing ISO format too');
  } finally {
    app.db.query = originalQuery; // ALWAYS restore, even on a thrown assertion above
    releaseResolve(); // ALWAYS release — a no-op if already resolved on the normal-success path
    if (heldGet) await heldGet.catch(() => {}); // drain it so no background promise is left dangling
  }
});

// ── 23) finding A ordering regression: the CREATED/no-footprint bypass must return offers in
// the SAME order listOffersByOrder does (created_at DESC) — never json_agg's unordered default.
// Offers are physically INSERTed out of created_at order (earliest first, latest second, middle
// third) specifically so a plain insertion-order aggregate would visibly disagree with the
// correct created_at DESC ordering — a coincidental match is ruled out by construction.
test('recovery gate: offers-GET bypass returns offers in the same created_at DESC order as listOffersByOrder', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}23`;
  const paxS = await mintSession(app, `+1711${ns}`);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'A' }, dropoff: { label: 'B' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const orderUuid = await internalOrderId(cleanup, order.id);

  const drivers = [];
  for (let i = 0; i < 3; i++) {
    const drvS = await mintSession(app, `+1712${ns}${i}`);
    drivers.push(drvS.user.userId);
  }
  // Insertion order (a, b, c) is deliberately NOT created_at order: a=earliest, b=latest, c=middle.
  const rowsToInsert = [
    { legacyId: 'offer-order-a', createdAt: '2026-08-31 09:00:00+00' },
    { legacyId: 'offer-order-b', createdAt: '2026-08-31 11:00:00+00' },
    { legacyId: 'offer-order-c', createdAt: '2026-08-31 10:00:00+00' },
  ];
  for (const [i, row] of rowsToInsert.entries()) {
    await cleanup.query(
      `INSERT INTO offers (legacy_id, order_id, driver_id, status, driver_name, created_at, updated_at, expires_at)
       VALUES ($1, $2, $3, 'sent', $4, $5, $5, $5::timestamptz + interval '15 minutes')`,
      [row.legacyId, orderUuid, drivers[i], `Driver ${i}`, row.createdAt],
    );
  }

  const bypassRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(bypassRes.statusCode, 200, 'still a genuine CREATED/no-footprint bypass');
  const bypassOrder = bypassRes.json().items.map((i) => i.id);

  // Independently compute the expected order the SAME way listOffersByOrder does — not hardcoded.
  const expectedRows = await listOffersByOrder(cleanup, orderUuid);
  const expectedOrder = expectedRows.map((r) => r.legacy_id);

  assert.deepEqual(expectedOrder, ['offer-order-b', 'offer-order-c', 'offer-order-a'],
    'sanity: the expected created_at DESC order genuinely differs from physical insertion order (a, b, c)');
  assert.deepEqual(bypassOrder, expectedOrder,
    "CREATED-bypass items are ordered EXACTLY like listOffersByOrder (created_at DESC), never json_agg's unordered default");
});

// ── 24) finding C fix-proof: a canonical trip_id whose backing order was physically deleted
// fails closed (409, no `ride` body) on ride-state-GET; offers-GET stays 404 (unaffected, since
// findOrderByLegacyId fails first — the order genuinely no longer exists). rides.order_id is
// ON DELETE SET NULL, so the Ride survives the delete with its canonical trip_id intact but
// candidate_order_count silently drops to 0 — exactly the shape a genuinely standalone Ride
// uses, which the fix must distinguish rather than collapse into a false bypass.
test('recovery gate: a canonical trip_id whose order was physically deleted fails closed (409), offers-GET stays 404 (Codex Finding C)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const cleanup = makeCleanupClient();
  await cleanup.connect();
  const tripIds = [];
  t.after(async () => {
    await deleteRidesWithEvents(cleanup, tripIds);
    await cleanup.end();
    await app.close();
  });

  const ns = `${process.pid}24`;
  const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
  tripIds.push(tripId);

  // Poison the cached snapshot BEFORE deleting the order — proves that if the bypass fired, it
  // would serve exactly this raw, unvalidated data.
  await cleanup.query(
    `UPDATE rides SET passenger_name = 'ORPHAN-LEAK-PASSENGER', driver_name = 'ORPHAN-LEAK-DRIVER',
        route_pickup_label = 'ORPHAN-LEAK-PICKUP', order_offer_price = 'ORPHAN-LEAK-PRICE'
      WHERE trip_id = $1`,
    [tripId],
  );

  const orderUuid = await internalOrderId(cleanup, order.id);
  await cleanup.query('DELETE FROM orders WHERE id = $1', [orderUuid]);
  const rideRowAfter = (await cleanup.query('SELECT order_id FROM rides WHERE trip_id = $1', [tripId])).rows[0];
  assert.equal(rideRowAfter.order_id, null, 'sanity: ON DELETE SET NULL fired — order_id is now null');

  const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
  assert.equal(rideRes.statusCode, 409, 'a canonical-but-now-unresolvable trip_id fails closed, never bypassed as standalone');
  assert.equal(rideRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
  assert.equal(rideRes.json().retryable, false);
  assert.equal(rideRes.json().ride, undefined, 'no raw/poisoned Ride body on failure');
  assert.equal(JSON.stringify(rideRes.json()).includes('ORPHAN-LEAK'), false, 'the poisoned cache never reaches the response');

  const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));
  assert.equal(offersRes.statusCode, 404, 'offers-GET is unaffected — findOrderByLegacyId fails first since the order no longer exists');
  assert.equal(offersRes.json().code, 'ORDER_NOT_FOUND');
});

// ── 25) finding D fix-proof: passenger_snapshot author-binding matrix — null passes (neutral
// projection unaffected); missing authorId, a mismatched real unrelated user, and malformed
// non-object snapshots all fail closed (409) on BOTH GETs, with no leak of the injected data.
test('recovery gate: passenger_snapshot author-binding matrix — null/missing/malformed/mismatched (Codex Finding D)', { skip: SKIP }, async (t) => {
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

  const MARKER = 'LEAK-CANARY-D';
  const cases = ['null-snapshot', 'missing-authorId', 'mismatched-real-user', 'malformed-string', 'malformed-array'];

  for (const [i, label] of cases.entries()) {
    const ns = `${process.pid}25${i}`;
    const { paxS, order, tripId } = await acceptedFixture(app, cleanup, ns);
    orderIds.push(order.id);

    let snapshotSql;
    if (label === 'null-snapshot') {
      snapshotSql = null;
    } else if (label === 'missing-authorId') {
      snapshotSql = JSON.stringify({ name: MARKER, phoneMasked: '+7 000' });
    } else if (label === 'mismatched-real-user') {
      const otherS = await mintSession(app, `+1715${ns}`);
      snapshotSql = JSON.stringify({ name: MARKER, phoneMasked: '+7 999 UNRELATED', authorId: otherS.user.userId });
    } else if (label === 'malformed-string') {
      snapshotSql = JSON.stringify(MARKER);
    } else {
      snapshotSql = JSON.stringify([MARKER]);
    }
    await cleanup.query('UPDATE orders SET passenger_snapshot = $1 WHERE legacy_id = $2', [snapshotSql, order.id]);

    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS));

    if (label === 'null-snapshot') {
      assert.equal(rideRes.statusCode, 200, `${label}: ride-state-GET still passes (neutral projection unaffected)`);
    } else {
      assert.equal(rideRes.statusCode, 409, `${label}: ride-state-GET fails closed`);
      assert.equal(rideRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
      assert.equal(offersRes.statusCode, 409, `${label}: offers-GET fails closed too`);
      assert.equal(offersRes.json().code, 'RIDE_RECOVERY_UNVERIFIED');
      assert.equal(JSON.stringify(rideRes.json()).includes(MARKER), false, `${label}: the injected marker never leaks into ride-state-GET`);
      assert.equal(JSON.stringify(offersRes.json()).includes(MARKER), false, `${label}: the injected marker never leaks into offers-GET`);
    }
  }
});

// ── 26) finding E fix-proof: every optional lifecycle timestamp strictly inside
// (created_at, accepted_at) — a stage stamp physically preceding acceptance, impossible under
// any real write path — fails closed via pg_chronology_ok on both bundle functions and both
// real GETs. Requires a raw multi-column INSERT (not accept-then-corrupt): a real accept always
// stamps created_at/accepted_at from the SAME transaction-start `now()`, so there is no
// measurable gap between them to place a timestamp into.
test('recovery gate: an optional lifecycle timestamp inside (created_at, accepted_at) fails closed via pg_chronology_ok (Codex Finding E)', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const client = makeCleanupClient();
  await client.connect();
  const tripIds = [];
  t.after(async () => {
    if (tripIds.length) await client.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    await client.query('DELETE FROM orders WHERE legacy_id LIKE $1', [`order-recovery-preaccept-%-${process.pid}`]).catch(() => {});
    await client.end();
    await app.close();
  });

  const OPTIONAL_COLUMNS = ['approaching_at', 'arrived_at', 'started_at', 'completed_at', 'canceled_at'];
  for (const [i, col] of OPTIONAL_COLUMNS.entries()) {
    const legacyId = `order-recovery-preaccept-${col}-${process.pid}`;
    const tripId = `trip_${legacyId}`;
    tripIds.push(tripId);
    const paxPhone = `+176${i}${String(process.pid).padStart(7, '0')}0`;
    const drvPhone = `+176${i}${String(process.pid).padStart(7, '0')}1`;
    const passenger = (await client.query(`INSERT INTO users (phone) VALUES ($1) RETURNING id`, [paxPhone])).rows[0];
    const driver = (await client.query(`INSERT INTO users (phone) VALUES ($1) RETURNING id`, [drvPhone])).rows[0];
    t.after(async () => {
      await client.query('DELETE FROM users WHERE id = ANY($1)', [[passenger.id, driver.id]]).catch(() => {});
    });

    const tCreated = '2026-08-31 08:00:00+00';
    const tPreAccept = '2026-08-31 08:30:00+00'; // strictly between created_at and accepted_at
    const tAccepted = '2026-08-31 09:00:00+00';
    const tUpdated = '2026-08-31 09:30:00+00';
    const orderRow = (await client.query(
      `INSERT INTO orders (legacy_id, passenger_id, status, accepted_at) VALUES ($1, $2, 'ACCEPTED', $3) RETURNING id`,
      [legacyId, passenger.id, tAccepted],
    )).rows[0];
    const cols = { approaching_at: null, arrived_at: null, started_at: null, completed_at: null, canceled_at: null };
    cols[col] = tPreAccept;
    await client.query(
      `INSERT INTO rides (trip_id, order_id, status, role, driver_user_id, passenger_user_id,
                           created_at, accepted_at, updated_at,
                           approaching_at, arrived_at, started_at, completed_at, canceled_at)
       VALUES ($1,$2,'ACCEPTED','passenger',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tripId, orderRow.id, driver.id, passenger.id, tCreated, tAccepted, tUpdated,
        cols.approaching_at, cols.arrived_at, cols.started_at, cols.completed_at, cols.canceled_at],
    );

    const bundle = await findRecoveryBundleByTripId(client, tripId);
    assert.equal(bundle.pg_chronology_ok, false, `${col} inside (created_at, accepted_at) trips pg_chronology_ok`);

    const paxS = await mintSession(app, paxPhone);
    const rideRes = await get(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`, bearer(paxS));
    assert.equal(rideRes.statusCode, 409, `${col} inside (created_at, accepted_at) fails ride-state-GET`);
    const offersRes = await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(legacyId)}`, bearer(paxS));
    assert.equal(offersRes.statusCode, 409, `${col} inside (created_at, accepted_at) fails offers-GET`);
  }
});
