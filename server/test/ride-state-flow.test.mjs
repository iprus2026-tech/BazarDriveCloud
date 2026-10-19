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

async function writeCounts(db, tripId) {
  return (await db.query(
    `SELECT (SELECT count(*)::int FROM ride_events WHERE trip_id = $1) AS ride_events,
            (SELECT count(*)::int
               FROM notification_outbox
              WHERE immutable_envelope #>> '{aggregate,key}' = $1) AS notification_outbox`,
    [tripId],
  )).rows[0];
}

test('ride-state: snapshot + transitions (stamp, status_change event, terminal-freeze) + guards', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const drv = `+1601${String(process.pid).padStart(7, '0')}`;
  const pax = `+1602${String(process.pid).padStart(7, '0')}`;
  const other = `+1603${String(process.pid).padStart(7, '0')}`;
  const tripId = `trip-r06-${process.pid}`;
  const noShowTripId = `trip-r06-noshow-${process.pid}`;
  const noShowWrongTripId = `trip-r06-noshow-wrong-${process.pid}`;
  const cancelTripId = `trip-r06-cancel-${process.pid}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => {
    // append-only timeline: drop test rows with triggers/FK checks off (CI superuser), best-effort.
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    for (const id of [tripId, noShowTripId, noShowWrongTripId, cancelTripId]) {
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
  // The driver walks the forward-only chain to WAITING_PASSENGER (BD-RIDE-AUTHORITY-01B-B).
  for (const status of ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER']) {
    const step = await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status }, bearer(drvS));
    assert.equal(step.statusCode, 200, `driver -> ${status}`);
  }
  // passenger boarding: WAITING_PASSENGER -> IN_PROGRESS stamps startedAt.
  const p2 = await patch(app, `/api/v1/ride-state/rides/${tripId}/status`, { status: 'IN_PROGRESS' }, bearer(paxS));
  assert.equal(p2.statusCode, 200, 'passenger boarding is allowed from WAITING_PASSENGER');
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

  // a status_change event was appended per accepted transition
  // (EN_ROUTE, APPROACHING, WAITING, IN_PROGRESS, COMPLETED = 5).
  const n = (await cleanup.query("SELECT count(*)::int AS n FROM ride_events WHERE trip_id = $1 AND type = 'status_change'", [tripId])).rows[0].n;
  assert.equal(n, 5, 'five status_change events appended (no event for the rejected/no-op patches)');
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
  assert.equal(outboxRows.length, 5, 'each accepted transition has exactly one outbox source');
  const audience = [drvS.user.userId.toLowerCase(), paxS.user.userId.toLowerCase()].sort();
  const expectedTransitions = [
    ['ACCEPTED', 'DRIVER_EN_ROUTE', drvS.user.userId.toLowerCase(), 'driver'],
    ['DRIVER_EN_ROUTE', 'DRIVER_APPROACHING_PICKUP', drvS.user.userId.toLowerCase(), 'driver'],
    ['DRIVER_APPROACHING_PICKUP', 'WAITING_PASSENGER', drvS.user.userId.toLowerCase(), 'driver'],
    ['WAITING_PASSENGER', 'IN_PROGRESS', paxS.user.userId.toLowerCase(), 'passenger'],
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

  // Ordinary driver CANCELED: reason/comment are request data, but actor/timestamp are server-owned.
  await cleanup.query(
    `INSERT INTO rides (trip_id, status, role, driver_user_id, passenger_user_id, driver_name)
       VALUES ($1, 'DRIVER_EN_ROUTE', 'driver', $2, $3, 'Иван')`,
    [cancelTripId, drvS.user.userId, paxS.user.userId],
  );

  const missingReason = await patch(
    app,
    `/api/v1/ride-state/rides/${cancelTripId}/status`,
    { status: 'CANCELED' },
    bearer(drvS),
  );
  assert.equal(missingReason.statusCode, 400);
  assert.equal(missingReason.json().code, 'CANCEL_REASON_REQUIRED');
  assert.deepEqual(
    await writeCounts(cleanup, cancelTripId),
    { ride_events: 0, notification_outbox: 0 },
    'missing driver reason writes nothing',
  );

  const spoofActor = await patch(
    app,
    `/api/v1/ride-state/rides/${cancelTripId}/status`,
    { status: 'CANCELED', cancel: { reason: 'wrong_pickup', by: 'passenger' } },
    bearer(drvS),
  );
  assert.equal(spoofActor.statusCode, 400, 'client cannot submit cancel actor');

  const canceled = await patch(
    app,
    `/api/v1/ride-state/rides/${cancelTripId}/status`,
    { status: 'CANCELED', cancel: { reason: 'other', comment: 'Gate is locked' } },
    bearer(drvS),
  );
  assert.equal(canceled.statusCode, 200);
  assert.equal(canceled.json().ride.status, 'CANCELED');
  assert.equal(canceled.json().ride.cancel.by, 'driver');
  assert.equal(canceled.json().ride.cancel.reason, 'other');
  assert.ok(canceled.json().ride.timestamps.canceledAt, 'ordinary cancellation stamps canceledAt');
  const cancelDb = (await cleanup.query(
    'SELECT cancel_by, cancel_reason, cancel_comment, canceled_at FROM rides WHERE trip_id = $1',
    [cancelTripId],
  )).rows[0];
  assert.equal(cancelDb.cancel_by, 'driver');
  assert.equal(cancelDb.cancel_reason, 'other');
  assert.equal(cancelDb.cancel_comment, 'Gate is locked');
  assert.ok(cancelDb.canceled_at);
  const canceledAt = canceled.json().ride.timestamps.canceledAt;

  const canceledRead = await get(app, `/api/v1/ride-state/rides/${cancelTripId}`, bearer(drvS));
  assert.equal(canceledRead.statusCode, 200);
  assert.equal(canceledRead.json().ride.cancel.by, 'driver');
  assert.equal(canceledRead.json().ride.cancel.reason, 'other');
  assert.equal(canceledRead.json().ride.timestamps.canceledAt, canceledAt);

  const canceledRetry = await patch(
    app,
    `/api/v1/ride-state/rides/${cancelTripId}/status`,
    { status: 'CANCELED', cancel: { reason: 'car_problem' } },
    bearer(drvS),
  );
  assert.equal(canceledRetry.statusCode, 200);
  assert.equal(canceledRetry.json().ride.cancel.reason, 'other', 'retry cannot overwrite first reason');
  assert.equal(canceledRetry.json().ride.timestamps.canceledAt, canceledAt, 'retry cannot re-stamp cancellation');
  const cancelDbAfterRetry = (await cleanup.query(
    'SELECT cancel_by, cancel_reason, cancel_comment FROM rides WHERE trip_id = $1',
    [cancelTripId],
  )).rows[0];
  assert.deepEqual(cancelDbAfterRetry, {
    cancel_by: 'driver', cancel_reason: 'other', cancel_comment: 'Gate is locked',
  });
  assert.deepEqual(
    await writeCounts(cleanup, cancelTripId),
    { ride_events: 1, notification_outbox: 1 },
    'ordinary cancellation writes one transition pair; retry writes none',
  );

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
  assert.deepEqual(
    await writeCounts(cleanup, noShowTripId),
    { ride_events: 0, notification_outbox: 0 },
    'rejected passenger NO_SHOW writes neither an event nor an outbox source',
  );

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
  assert.deepEqual(
    await writeCounts(cleanup, noShowTripId),
    { ride_events: 1, notification_outbox: 1 },
    'accepted NO_SHOW writes one pair and its retry writes none',
  );
  const noShowOutbox = (await cleanup.query(
    `SELECT o.immutable_envelope
       FROM notification_outbox o
      WHERE o.immutable_envelope #>> '{aggregate,key}' = $1`,
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
  assert.deepEqual(
    await writeCounts(cleanup, noShowWrongTripId),
    { ride_events: 0, notification_outbox: 0 },
    'rejected ACCEPTED -> NO_SHOW writes neither an event nor an outbox source',
  );

  // A different terminal state keeps the existing terminal-freeze response.
  const terminalWritesBefore = await writeCounts(cleanup, tripId);
  const terminalNoShow = await patch(
    app,
    `/api/v1/ride-state/rides/${tripId}/status`,
    { status: 'NO_SHOW' },
    bearer(drvS),
  );
  assert.equal(terminalNoShow.statusCode, 409);
  assert.equal(terminalNoShow.json().code, 'RIDE_TERMINAL');
  assert.deepEqual(
    terminalWritesBefore,
    { ride_events: 5, notification_outbox: 5 },
    'terminal rejection starts from the five accepted transition pairs',
  );
  assert.deepEqual(
    await writeCounts(cleanup, tripId),
    terminalWritesBefore,
    'rejected COMPLETED -> NO_SHOW writes zero additional events and outbox sources',
  );
});
