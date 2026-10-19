// /server/test/ride-state-authority-flow.test.mjs — DB-gated acceptance for BD-RIDE-AUTHORITY-01B-B
// (docs/ride-state-receipt-authority-contract.md §1) through the real Fastify app + real Postgres:
// per-role, forward-only ride status changes on PATCH /api/v1/ride-state/rides/:tripId/status.
// Rides are SEEDED directly at the status under test (like ride-state-flow.test.mjs); every
// refusal must leave the ride row, ride_events and the notification outbox untouched.
// SKIPPED without DATABASE_URL; runs in server-ci.
//
// CLEANUP mirrors ride-state-flow.test.mjs: ride_events is append-only, so the CI superuser
// briefly sets session_replication_role='replica' to drop the test's rows (best-effort).
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
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

async function rideFacts(db, tripId) {
  return (await db.query(
    `SELECT r.status,
            (SELECT count(*)::int FROM ride_events WHERE trip_id = $1) AS ride_events,
            (SELECT count(*)::int FROM notification_outbox
              WHERE immutable_envelope #>> '{aggregate,key}' = $1) AS notification_outbox
       FROM rides r WHERE r.trip_id = $1`,
    [tripId],
  )).rows[0];
}

test('ride-state authority: per-role, forward-only transitions and passenger cancel window', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const tag = String(process.pid).padStart(7, '0');
  const drv = `+1611${tag}`;
  const pax = `+1612${tag}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const tripIds = [];
  t.after(async () => {
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    for (const id of tripIds) {
      await cleanup.query("DELETE FROM notification_outbox WHERE immutable_envelope #>> '{aggregate,key}' = $1", [id]).catch(() => {});
      await cleanup.query('DELETE FROM ride_events WHERE trip_id = $1', [id]).catch(() => {});
      await cleanup.query('DELETE FROM rides WHERE trip_id = $1', [id]).catch(() => {});
    }
    await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
    for (const p of [drv, pax]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const drvS = await mintSession(app, drv);
  const paxS = await mintSession(app, pax);
  const actor = { driver: drvS, passenger: paxS };
  let seq = 0;
  async function seedRide(status) {
    seq += 1;
    const tripId = `trip-01bb-${process.pid}-${seq}`;
    tripIds.push(tripId);
    // Terminal seeds carry the stamp their CHECK requires (rides_completed_stamp /
    // rides_terminal_cancel_stamp); non-terminal seeds need none for the PATCH path.
    await cleanup.query(
      `INSERT INTO rides (trip_id, status, role, driver_user_id, passenger_user_id, driver_name,
                          completed_at, canceled_at, cancel_by, cancel_reason)
         VALUES ($1, $2, 'driver', $3, $4, 'Иван',
                 CASE WHEN $2 = 'COMPLETED' THEN now() END,
                 CASE WHEN $2 IN ('CANCELED', 'NO_SHOW') THEN now() END,
                 CASE WHEN $2 IN ('CANCELED', 'NO_SHOW') THEN 'driver' END,
                 CASE WHEN $2 = 'CANCELED' THEN 'car_problem' WHEN $2 = 'NO_SHOW' THEN 'passenger_no_show' END)`,
      [tripId, status, drvS.user.userId, paxS.user.userId],
    );
    return tripId;
  }
  const send = (role, tripId, body) => patch(app, `/api/v1/ride-state/rides/${tripId}/status`, body, bearer(actor[role]));

  async function expectRefused(role, from, body, status, code) {
    const tripId = await seedRide(from);
    const before = await rideFacts(cleanup, tripId);
    const res = await send(role, tripId, body);
    const label = `${role}: ${from} -> ${body.status}`;
    assert.equal(res.statusCode, status, label);
    assert.equal(res.json().code, code, label);
    assert.equal(res.json().retryable, false, label);
    assert.deepEqual(await rideFacts(cleanup, tripId), before, `${label} writes nothing`);
  }
  async function expectApplied(role, from, body) {
    const tripId = await seedRide(from);
    const res = await send(role, tripId, body);
    const label = `${role}: ${from} -> ${body.status}`;
    assert.equal(res.statusCode, 200, label);
    assert.equal(res.json().ride.status, body.status, label);
    const facts = await rideFacts(cleanup, tripId);
    assert.deepEqual(facts, { status: body.status, ride_events: 1, notification_outbox: 1 }, `${label} writes one event pair`);
    const eventRole = (await cleanup.query('SELECT role FROM ride_events WHERE trip_id = $1', [tripId])).rows[0].role;
    assert.equal(eventRole, role, `${label} records the actor role`);
    return res;
  }

  // Allowed: the driver chain step by step, and passenger boarding.
  await expectApplied('driver', 'ACCEPTED', { status: 'DRIVER_EN_ROUTE' });
  await expectApplied('driver', 'DRIVER_EN_ROUTE', { status: 'DRIVER_APPROACHING_PICKUP' });
  await expectApplied('driver', 'DRIVER_APPROACHING_PICKUP', { status: 'WAITING_PASSENGER' });
  await expectApplied('driver', 'WAITING_PASSENGER', { status: 'IN_PROGRESS' });
  await expectApplied('driver', 'IN_PROGRESS', { status: 'COMPLETED' });
  await expectApplied('passenger', 'WAITING_PASSENGER', { status: 'IN_PROGRESS' });

  // The other role's targets -> 403 RIDE_ROLE_FORBIDDEN.
  for (const [from, to] of [
    ['DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP'],
    ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER'],
    ['IN_PROGRESS', 'COMPLETED'],
  ]) {
    await expectRefused('passenger', from, { status: to }, 403, 'RIDE_ROLE_FORBIDDEN');
  }

  // Skips and backward moves -> 409 RIDE_TRANSITION_NOT_ALLOWED.
  await expectRefused('passenger', 'DRIVER_EN_ROUTE', { status: 'IN_PROGRESS' }, 409, 'RIDE_TRANSITION_NOT_ALLOWED');
  for (const [from, to] of [
    ['DRIVER_EN_ROUTE', 'WAITING_PASSENGER'],
    ['DRIVER_EN_ROUTE', 'IN_PROGRESS'],
    ['DRIVER_EN_ROUTE', 'COMPLETED'],
    ['WAITING_PASSENGER', 'DRIVER_EN_ROUTE'],
    ['WAITING_PASSENGER', 'DRIVER_APPROACHING_PICKUP'],
    ['IN_PROGRESS', 'WAITING_PASSENGER'],
  ]) {
    await expectRefused('driver', from, { status: to }, 409, 'RIDE_TRANSITION_NOT_ALLOWED');
  }

  // Targets owned by nobody -> 409 for both roles.
  for (const role of ['driver', 'passenger']) {
    await expectRefused(role, 'DRIVER_EN_ROUTE', { status: 'ACCEPTED' }, 409, 'RIDE_TRANSITION_NOT_ALLOWED');
    await expectRefused(role, 'DRIVER_EN_ROUTE', { status: 'NEW_ORDER' }, 409, 'RIDE_TRANSITION_NOT_ALLOWED');
  }

  // Terminal rides keep RIDE_TERMINAL for the owner's targets.
  await expectRefused('driver', 'COMPLETED', { status: 'IN_PROGRESS' }, 409, 'RIDE_TERMINAL');
  await expectRefused('passenger', 'CANCELED', { status: 'IN_PROGRESS' }, 409, 'RIDE_TERMINAL');

  // Same-status: a no-op for the owner, 403 for the other role.
  {
    const tripId = await seedRide('IN_PROGRESS');
    for (const role of ['driver', 'passenger']) {
      const res = await send(role, tripId, { status: 'IN_PROGRESS' });
      assert.equal(res.statusCode, 200, `${role} IN_PROGRESS retry is a no-op`);
    }
    assert.deepEqual(await rideFacts(cleanup, tripId), { status: 'IN_PROGRESS', ride_events: 0, notification_outbox: 0 });
  }
  await expectRefused('passenger', 'DRIVER_EN_ROUTE', { status: 'DRIVER_EN_ROUTE' }, 403, 'RIDE_ROLE_FORBIDDEN');

  // Passenger cancel window: allowed before IN_PROGRESS, refused from IN_PROGRESS (even with a
  // reason, and before reason validation).
  for (const from of ['DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER']) {
    const res = await expectApplied('passenger', from, { status: 'CANCELED' });
    assert.equal(res.json().ride.cancel.by, 'passenger');
  }
  await expectRefused('passenger', 'IN_PROGRESS', { status: 'CANCELED' }, 409, 'RIDE_TRANSITION_NOT_ALLOWED');
  await expectRefused('passenger', 'IN_PROGRESS', { status: 'CANCELED', cancel: { reason: 'changed_mind' } }, 409, 'RIDE_TRANSITION_NOT_ALLOWED');
  await expectRefused('passenger', 'IN_PROGRESS', { status: 'CANCELED', cancel: { reason: 'not-a-reason' } }, 409, 'RIDE_TRANSITION_NOT_ALLOWED');

  // Driver cancel from IN_PROGRESS: reason required (unchanged), then allowed.
  await expectRefused('driver', 'IN_PROGRESS', { status: 'CANCELED' }, 400, 'CANCEL_REASON_REQUIRED');
  const driverCancel = await expectApplied('driver', 'IN_PROGRESS', { status: 'CANCELED', cancel: { reason: 'unsafe_situation' } });
  assert.equal(driverCancel.json().ride.cancel.by, 'driver');
  assert.equal(driverCancel.json().ride.cancel.reason, 'unsafe_situation');
});
