// /server/test/ride-state-flow.test.mjs — DB-gated end-to-end for R06 (#5 Ride State chokepoint)
// through the real Fastify app + real Postgres. There is no API to create a `rides` row yet (that
// is R10), so the test SEEDS one directly, then drives GET snapshot + PATCH status through the
// endpoint: participant gating, a status advance with timestamp stamping, the append-only
// status_change event + transactional notification source, and the terminal-freeze. SKIPPED
// without DATABASE_URL; runs in server-ci.
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
  const noShowTripId = `trip-r06-noshow-${process.pid}`;
  const noShowWrongTripId = `trip-r06-noshow-wrong-${process.pid}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => {
    // append-only timeline: drop test rows with triggers/FK checks off (CI superuser), best-effort.
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    for (const id of [tripId, noShowTripId, noShowWrongTripId]) {
      await cleanup.query(
        "DELETE FROM notification_outbox WHERE immutable_envelope #>> '{aggregate,key}' = $1",
        [id],
      ).catch(() => {});
      await cleanup.query('DELETE FROM ride_events WHERE trip_id = $1', [id]).catch(() => {});
      await cleanup.query('DELETE FROM rides WHERE trip_id = $1', [id]).catch(() => {});
    }
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

  // A fully-migrated DB reports ready only when both the status_change source and its
  // transactional outbox (0004) exist.
  assert.equal((await get(app, '/api/v1/readyz')).statusCode, 200, 'readyz is green once 0004 is applied');

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
  // idempotent retry: re-PATCH the SAME non-terminal status -> no-op (no re-stamp, no new event).
  const startedAt = p2.json().ride.timestamps.startedAt;
  const retry = await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'IN_PROGRESS' }, bearer(drvS));
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().ride.timestamps.startedAt, startedAt, 'a same-status retry does not re-stamp the lifecycle timestamp');

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
  const outboxRows = (await cleanup.query(
    `SELECT o.outbox_seq::text AS event_seq,
            o.source_event_id::text,
            o.immutable_envelope,
            e.id::text AS event_id,
            e.ride_id::text,
            e.role,
            e.payload->>'from' AS from_status,
            e.payload->>'to' AS to_status,
            to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS event_at,
            to_char(o.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS outbox_at
       FROM notification_outbox o
       JOIN ride_events e ON e.id = o.source_event_id
      WHERE e.trip_id = $1 AND e.type = 'status_change'
      ORDER BY e.at, e.id`,
    [tripId],
  )).rows;
  assert.equal(outboxRows.length, 3, 'each accepted transition has exactly one outbox source');
  const audience = [drvS.user.userId.toLowerCase(), paxS.user.userId.toLowerCase()].sort();
  const expectedTransitions = [
    ['ACCEPTED', 'DRIVER_EN_ROUTE', drvS.user.userId.toLowerCase(), 'driver'],
    ['DRIVER_EN_ROUTE', 'IN_PROGRESS', paxS.user.userId.toLowerCase(), 'passenger'],
    ['IN_PROGRESS', 'COMPLETED', drvS.user.userId.toLowerCase(), 'driver'],
  ];
  const rowsByTransition = new Map(outboxRows.map((row) => [
    `${row.from_status}->${row.to_status}`,
    row,
  ]));
  expectedTransitions.forEach(([fromStatus, toStatus, actorUserId, actorRole]) => {
    const row = rowsByTransition.get(`${fromStatus}->${toStatus}`);
    assert.ok(row, `outbox row exists for ${fromStatus} -> ${toStatus}`);
    assert.equal(row.source_event_id, row.event_id, 'source_event_id is exactly ride_events.id');
    assert.equal(row.outbox_at, row.event_at, 'occurred_at is exactly ride_events.at');
    assert.match(row.event_seq, /^[1-9][0-9]*$/, 'eventSeq materializes separately as decimal text');
    assert.equal(Object.hasOwn(row.immutable_envelope, 'eventSeq'), false, 'eventSeq is not immutable content');
    assert.deepEqual(row.immutable_envelope, {
      eventId: row.event_id,
      eventType: 'ride.status_changed.v1',
      schemaVersion: 1,
      producer: 'ride-state',
      aggregate: { type: 'ride', id: row.ride_id, key: tripId },
      occurredAt: row.event_at,
      actor: { userId: actorUserId, role: actorRole },
      audience: { policyVersion: 1, userIds: audience },
      payload: { fromStatus, toStatus },
    }, 'immutable envelope is the exact privacy allowlist');
  });

  // V2-04C1: backend-owned NO_SHOW authority. Seed a waiting ride for the assigned driver.
  await cleanup.query(
    `INSERT INTO rides (trip_id, status, role, driver_user_id, passenger_user_id, driver_name, route_pickup_label, route_dropoff_label, arrived_at)
       VALUES ($1, 'WAITING_PASSENGER', 'driver', $2, $3, 'Иван', 'Дом', 'Центр', now())`,
    [noShowTripId, drvS.user.userId, paxS.user.userId],
  );

  // Passenger is a participant, but NO_SHOW authority is driver-only.
  const passengerNoShow = await patch(
    app,
    `/api/v1/ride-state/rides/${noShowTripId}/status`,
    { status: 'NO_SHOW' },
    bearer(paxS),
  );
  assert.equal(passengerNoShow.statusCode, 403, 'passenger cannot mark no-show');
  assert.equal(passengerNoShow.json().code, 'FORBIDDEN');

  // Assigned driver may close WAITING_PASSENGER as NO_SHOW; cancel metadata is server-derived.
  const noShow = await patch(
    app,
    `/api/v1/ride-state/rides/${noShowTripId}/status`,
    { status: 'NO_SHOW' },
    bearer(drvS),
  );
  assert.equal(noShow.statusCode, 200);
  assert.equal(noShow.json().ride.status, 'NO_SHOW');
  assert.equal(noShow.json().ride.cancel.by, 'driver');
  assert.equal(noShow.json().ride.cancel.reason, 'passenger_no_show');
  assert.ok(noShow.json().ride.timestamps.canceledAt, 'NO_SHOW stamps canceledAt');
  const noShowCanceledAt = noShow.json().ride.timestamps.canceledAt;

  // Driver retry is idempotent: same terminal timestamp, no duplicate status_change event.
  const noShowRetry = await patch(
    app,
    `/api/v1/ride-state/rides/${noShowTripId}/status`,
    { status: 'NO_SHOW' },
    bearer(drvS),
  );
  assert.equal(noShowRetry.statusCode, 200);
  assert.equal(noShowRetry.json().ride.timestamps.canceledAt, noShowCanceledAt);
  const noShowEvents = (await cleanup.query(
    "SELECT count(*)::int AS n FROM ride_events WHERE trip_id = $1 AND type = 'status_change'",
    [noShowTripId],
  )).rows[0].n;
  assert.equal(noShowEvents, 1, 'NO_SHOW retry does not append a duplicate event');
  const noShowOutbox = (await cleanup.query(
    `SELECT o.immutable_envelope
       FROM notification_outbox o
       JOIN ride_events e ON e.id = o.source_event_id
      WHERE e.trip_id = $1`,
    [noShowTripId],
  )).rows;
  assert.equal(noShowOutbox.length, 1, 'accepted NO_SHOW has one outbox row; retry has none');
  assert.deepEqual(noShowOutbox[0].immutable_envelope.actor, {
    userId: drvS.user.userId.toLowerCase(), role: 'driver',
  });
  assert.deepEqual(noShowOutbox[0].immutable_envelope.payload, {
    fromStatus: 'WAITING_PASSENGER', toStatus: 'NO_SHOW',
  });

  // Driver cannot jump to NO_SHOW from another non-terminal state.
  await cleanup.query(
    `INSERT INTO rides (trip_id, status, role, driver_user_id, passenger_user_id, driver_name)
       VALUES ($1, 'ACCEPTED', 'driver', $2, $3, 'Иван')`,
    [noShowWrongTripId, drvS.user.userId, paxS.user.userId],
  );
  const wrongFrom = await patch(
    app,
    `/api/v1/ride-state/rides/${noShowWrongTripId}/status`,
    { status: 'NO_SHOW' },
    bearer(drvS),
  );
  assert.equal(wrongFrom.statusCode, 409);
  assert.equal(wrongFrom.json().code, 'RIDE_TRANSITION_NOT_ALLOWED');

  // A different terminal state keeps the existing terminal-freeze response.
  const terminalNoShow = await patch(
    app,
    `/api/v1/ride-state/rides/${tripId}/status`,
    { status: 'NO_SHOW' },
    bearer(drvS),
  );
  assert.equal(terminalNoShow.statusCode, 409);
  assert.equal(terminalNoShow.json().code, 'RIDE_TERMINAL');
  const rejectedOutboxCounts = (await cleanup.query(
    `SELECT immutable_envelope #>> '{aggregate,key}' AS trip_id, count(*)::int AS n
       FROM notification_outbox
      WHERE immutable_envelope #>> '{aggregate,key}' = ANY($1::text[])
      GROUP BY immutable_envelope #>> '{aggregate,key}'`,
    [[tripId, noShowTripId, noShowWrongTripId]],
  )).rows;
  assert.deepEqual(
    Object.fromEntries(rejectedOutboxCounts.map((row) => [row.trip_id, row.n])),
    { [tripId]: 3, [noShowTripId]: 1 },
    'rejected/no-op paths never append notification sources',
  );
});
