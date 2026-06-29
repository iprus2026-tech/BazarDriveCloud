// /server/test/ride-state-flow.test.mjs — DB-gated end-to-end for R06 (#5 Ride State chokepoint)
// through the real Fastify app + real Postgres. There is no API to create a `rides` row yet (that
// is R10), so the test SEEDS one directly, then drives GET snapshot + PATCH status through the
// endpoint: participant gating, a status advance with timestamp stamping, the append-only
// status_change event, and the terminal-freeze. SKIPPED without DATABASE_URL; runs in server-ci.
//
// CLEANUP: ride_events is append-only (trg_ride_events_no_mutation rejects DELETE; rides<-ride_events
// is ON DELETE RESTRICT), so the rows can't be deleted normally. The CI db is the postgres superuser,
// so cleanup briefly sets session_replication_role='replica' to drop the test's rows; best-effort
// (the CI database is ephemeral, so residue is harmless if it can't).
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
const get = (app, url, headers) => app.inject({ method: 'GET', url, headers });
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const bearer = (s) => ({ authorization: `Bearer ${s.token}` });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

test('ride-state: snapshot + transitions (stamp, status_change event, terminal-freeze) + guards', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const drv = `+1601${String(process.pid).padStart(7, '0')}`;
  const pax = `+1602${String(process.pid).padStart(7, '0')}`;
  const other = `+1603${String(process.pid).padStart(7, '0')}`;
  const tripId = `trip-r06-${process.pid}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => {
    // append-only timeline: drop test rows with triggers/FK checks off (CI superuser), best-effort.
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    await cleanup.query('DELETE FROM ride_events WHERE trip_id = $1', [tripId]).catch(() => {});
    await cleanup.query('DELETE FROM rides WHERE trip_id = $1', [tripId]).catch(() => {});
    await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
    for (const p of [drv, pax, other]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const drvS = await mintSession(app, drv);
  const paxS = await mintSession(app, pax);
  const otherS = await mintSession(app, other);

  // seed a ride (no R10 yet): the two test users are the participants; start ACCEPTED.
  await cleanup.query(
    `INSERT INTO rides (trip_id, status, role, driver_user_id, passenger_user_id, driver_name, route_pickup_label, route_dropoff_label)
       VALUES ($1, 'ACCEPTED', 'driver', $2, $3, 'Иван', 'Дом', 'Центр')`,
    [tripId, drvS.user.userId, paxS.user.userId],
  );

  // GET snapshot — participant only.
  const snap = await get(app, `/api/v1/ride-state/rides/${tripId}`, bearer(drvS));
  assert.equal(snap.statusCode, 200);
  assert.equal(snap.json().ride.status, 'ACCEPTED');
  assert.equal(snap.json().ride.tripId, tripId);
  assert.equal(snap.json().ride.driver.name, 'Иван');
  assert.equal((await get(app, `/api/v1/ride-state/rides/${tripId}`, bearer(otherS))).statusCode, 403, 'non-participant cannot read');
  assert.equal((await get(app, `/api/v1/ride-state/rides/${tripId}`)).statusCode, 401, 'anon cannot read');
  assert.equal((await get(app, '/api/v1/ride-state/rides/trip-nope', bearer(drvS))).statusCode, 404, 'unknown trip -> 404');

  // PATCH advance: ACCEPTED -> DRIVER_EN_ROUTE stamps acceptedAt.
  const p1 = await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'DRIVER_EN_ROUTE' }, bearer(drvS));
  assert.equal(p1.statusCode, 200);
  assert.equal(p1.json().ride.status, 'DRIVER_EN_ROUTE');
  assert.ok(p1.json().ride.timestamps.acceptedAt, 'acceptedAt stamped');
  // -> IN_PROGRESS stamps startedAt.
  const p2 = await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'IN_PROGRESS' }, bearer(paxS));
  assert.ok(p2.json().ride.timestamps.startedAt, 'startedAt stamped');

  // guards: non-participant 403, invalid status 400.
  assert.equal((await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'COMPLETED' }, bearer(otherS))).statusCode, 403);
  const badStatus = await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'BOGUS' }, bearer(drvS));
  assert.equal(badStatus.statusCode, 400);
  assert.equal(badStatus.json().code, 'INVALID_STATUS');

  // -> COMPLETED (terminal) stamps completedAt.
  const done = await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'COMPLETED' }, bearer(drvS));
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().ride.status, 'COMPLETED');
  assert.ok(done.json().ride.timestamps.completedAt, 'completedAt stamped');

  // terminal-freeze: COMPLETED -> CANCELED is refused; COMPLETED -> COMPLETED is an idempotent no-op.
  assert.equal((await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'CANCELED' }, bearer(drvS))).statusCode, 409, 'terminal ride cannot transition out');
  assert.equal((await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'COMPLETED' }, bearer(drvS))).statusCode, 200, 'idempotent same-status is allowed');

  // a status_change event was appended per accepted transition (EN_ROUTE, IN_PROGRESS, COMPLETED = 3).
  const n = (await cleanup.query("SELECT count(*)::int AS n FROM ride_events WHERE trip_id = $1 AND type = 'status_change'", [tripId])).rows[0].n;
  assert.equal(n, 3, 'three status_change events appended (no event for the rejected/no-op patches)');
});
