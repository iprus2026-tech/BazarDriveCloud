// /server/test/notification-outbox-flow.test.mjs — PostgreSQL-gated contract proofs for
// BD-NOTIF-OUTBOX-RUNTIME-01B (#943): exact microseconds + JCS digest/idempotency/collision,
// atomic rollback through the real Ride endpoint, and sequence-vs-commit-order inversion.
// No global DDL, trigger swaps, sleeps or sequence resets: the file is safe beside parallel tests.
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { insertRideStatusNotificationOutbox } from '../src/repositories/notification_outbox.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';

const config = {
  nodeEnv: 'test', isProd: false, port: 0, host: '127.0.0.1', logLevel: 'silent',
  databaseUrl: DATABASE_URL, allowedOrigin: '', sessionSecret: '',
  otp: { ttlSeconds: 300, length: 4, maxAttempts: 5, devMode: true },
  session: { ttlSeconds: 0 },
  redisUrl: '', s3: { endpoint: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
};

let fixtureCounter = 0;

function nextIdentity(label) {
  fixtureCounter += 1;
  const pid = String(process.pid % 100000).padStart(5, '0');
  const counter = String(fixtureCounter).padStart(3, '0');
  return {
    tripId: `trip-outbox-${process.pid}-${fixtureCounter}-${label}`,
    passengerPhone: `+1999${pid}${counter}0`,
    driverPhone: `+1999${pid}${counter}1`,
  };
}

async function withTransaction(client, fn) {
  await client.query('BEGIN');
  try {
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function seedStatusChange(client, {
  label,
  occurredAt = '2026-09-01T12:34:56.123456Z',
  fromStatus = 'ACCEPTED',
  toStatus = 'DRIVER_EN_ROUTE',
  actorRole = 'driver',
  sameParticipant = false,
}) {
  const identity = nextIdentity(label);
  const passenger = (await client.query(
    `INSERT INTO users (phone, role) VALUES ($1, 'passenger') RETURNING id::text`,
    [identity.passengerPhone],
  )).rows[0];
  const driver = sameParticipant
    ? passenger
    : (await client.query(
      `INSERT INTO users (phone, role) VALUES ($1, 'driver') RETURNING id::text`,
      [identity.driverPhone],
    )).rows[0];
  const ride = (await client.query(
    `INSERT INTO rides
       (trip_id, status, role, passenger_user_id, driver_user_id, accepted_at)
     VALUES ($1, $2, 'driver', $3, $4, now())
     RETURNING id::text`,
    [identity.tripId, toStatus, passenger.id, driver.id],
  )).rows[0];
  const event = (await client.query(
    `INSERT INTO ride_events (ride_id, trip_id, type, role, payload, at)
     VALUES ($1, $2, 'status_change', $3, $4, $5::timestamptz)
     RETURNING id::text`,
    [ride.id, identity.tripId, actorRole, { from: fromStatus, to: toStatus }, occurredAt],
  )).rows[0];

  return {
    ...identity,
    passengerUserId: passenger.id,
    driverUserId: driver.id,
    rideId: ride.id,
    eventId: event.id,
    occurredAt,
    fromStatus,
    toStatus,
    actorRole,
    actorUserId: actorRole === 'driver' ? driver.id : passenger.id,
  };
}

function expectedEnvelope(fixture, overrides = {}) {
  const envelope = {
    eventId: fixture.eventId.toLowerCase(),
    eventType: 'ride.status_changed.v1',
    schemaVersion: 1,
    producer: 'ride-state',
    aggregate: {
      type: 'ride',
      id: fixture.rideId.toLowerCase(),
      key: fixture.tripId,
    },
    occurredAt: fixture.occurredAt,
    actor: {
      userId: fixture.actorUserId.toLowerCase(),
      role: fixture.actorRole,
    },
    audience: {
      policyVersion: 1,
      userIds: [fixture.passengerUserId.toLowerCase(), fixture.driverUserId.toLowerCase()].sort(),
    },
    payload: {
      fromStatus: fixture.fromStatus,
      toStatus: fixture.toStatus,
    },
  };
  return { ...envelope, ...overrides };
}

// Independent, test-side JCS implementation for this JSON-only fixture. It deliberately does
// not import production canonicalization, so a shared implementation bug cannot make the digest
// assertion pass tautologically.
function jcs(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${jcs(value[key])}`).join(',')}}`;
}

async function cleanupFixtures(client, fixtures) {
  const tripIds = fixtures.map((fixture) => fixture.tripId);
  const eventIds = fixtures.map((fixture) => fixture.eventId).filter(Boolean);
  const phones = fixtures.flatMap((fixture) => [fixture.passengerPhone, fixture.driverPhone]);
  if (tripIds.length === 0) return;
  try {
    await client.query("SET session_replication_role = 'replica'");
    await client.query(
      `DELETE FROM notification_outbox
        WHERE source_event_id = ANY($1::uuid[])
           OR immutable_envelope #>> '{aggregate,key}' = ANY($2::text[])`,
      [eventIds, tripIds],
    );
    await client.query('DELETE FROM ride_events WHERE trip_id = ANY($1::text[])', [tripIds]);
    await client.query('DELETE FROM rides WHERE trip_id = ANY($1::text[])', [tripIds]);
  } finally {
    await client.query("SET session_replication_role = 'origin'").catch(() => {});
  }
  await client.query('DELETE FROM users WHERE phone = ANY($1::text[])', [phones]).catch(() => {});
  await client.query('DELETE FROM auth_otp WHERE phone = ANY($1::text[])', [phones]).catch(() => {});
}

const post = (app, url, payload, headers) => app.inject({ method: 'POST', url, payload, headers });
const patch = (app, url, payload, headers) => app.inject({ method: 'PATCH', url, payload, headers });
const bearer = (session) => ({ authorization: `Bearer ${session.token}` });

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

test('notification outbox: raw PostgreSQL insert detail is normalized before logging', async () => {
  const raw = Object.assign(new Error('check constraint failed'), {
    code: '23514',
    detail: 'Failing row contains (private envelope and user identifiers)',
  });
  const source = {
    source_event_id: '11111111-1111-4111-8111-111111111111',
    role: 'driver',
    from_status: 'ACCEPTED',
    to_status: 'DRIVER_EN_ROUTE',
    occurred_at: '2026-09-01T12:34:56.123456Z',
    aggregate_id: '22222222-2222-4222-8222-222222222222',
    aggregate_key: 'trip-error-normalization',
    passenger_user_id: '33333333-3333-4333-8333-333333333333',
    driver_user_id: '44444444-4444-4444-8444-444444444444',
  };
  const db = {
    async query(sql) {
      if (sql.includes('JOIN rides r')) return { rows: [source] };
      if (sql.includes('INSERT INTO notification_outbox')) throw raw;
      throw new Error('unexpected query');
    },
  };

  await assert.rejects(
    insertRideStatusNotificationOutbox(db, {
      sourceEventId: source.source_event_id,
      actorUserId: source.driver_user_id,
      actorRole: 'driver',
    }),
    (error) => {
      assert.equal(error.code, 'NOTIFICATION_OUTBOX_INSERT_FAILED');
      assert.equal(error.message, 'notification outbox insert failed');
      assert.equal(Object.hasOwn(error, 'detail'), false);
      assert.equal(Object.hasOwn(error, 'cause'), false);
      assert.equal(JSON.stringify(error).includes(source.driver_user_id), false);
      return true;
    },
  );
});

test('notification outbox: exact microseconds, JCS digest, idempotency and hard collision', { skip: SKIP }, async (t) => {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  const fixtures = [];
  await client.connect();
  t.after(async () => {
    await cleanupFixtures(client, fixtures).catch(() => {});
    await client.end();
  });

  const exact = await seedStatusChange(client, {
    label: 'exact',
    occurredAt: '2026-09-01T12:34:56.123456Z',
  });
  fixtures.push(exact);

  const first = await withTransaction(client, (tx) => insertRideStatusNotificationOutbox(tx, {
    sourceEventId: exact.eventId,
    actorUserId: exact.actorUserId,
    actorRole: exact.actorRole,
  }));
  assert.equal(first.inserted, true);
  assert.match(first.eventSeq, /^[1-9][0-9]*$/);

  const expected = expectedEnvelope(exact);
  const expectedDigest = createHash('sha256').update(jcs(expected), 'utf8').digest('hex');
  const stored = (await client.query(
    `SELECT outbox_seq::text AS event_seq,
            source_event_id::text,
            immutable_envelope,
            encode(immutable_digest, 'hex') AS immutable_digest,
            to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS outbox_at,
            (SELECT to_char(e.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               FROM ride_events e WHERE e.id = source_event_id) AS event_at
       FROM notification_outbox
      WHERE source_event_id = $1`,
    [exact.eventId],
  )).rows[0];
  assert.equal(stored.source_event_id, exact.eventId);
  assert.equal(stored.event_at, exact.occurredAt);
  assert.equal(stored.outbox_at, exact.occurredAt);
  assert.equal(stored.immutable_envelope.occurredAt, exact.occurredAt);
  assert.deepEqual(stored.immutable_envelope, expected, 'envelope contains only the immutable allowlist');
  assert.equal(Object.hasOwn(stored.immutable_envelope, 'eventSeq'), false);
  assert.equal(stored.immutable_digest, expectedDigest, 'digest is SHA-256 over independent JCS bytes');

  const replay = await withTransaction(client, (tx) => insertRideStatusNotificationOutbox(tx, {
    sourceEventId: exact.eventId.toUpperCase(),
    actorUserId: exact.actorUserId.toUpperCase(),
    actorRole: exact.actorRole,
  }));
  assert.equal(replay.inserted, false, 'same source and canonical immutable content is a no-op');
  assert.equal(replay.eventSeq, first.eventSeq, 'idempotent replay returns the original sequence');
  assert.equal((await client.query(
    'SELECT count(*)::int AS n FROM notification_outbox WHERE source_event_id = $1',
    [exact.eventId],
  )).rows[0].n, 1);

  await assert.rejects(
    client.query('UPDATE notification_outbox SET occurred_at = occurred_at WHERE source_event_id = $1', [exact.eventId]),
    (error) => error.code === 'P0001',
    'even a no-op UPDATE is rejected by the append-only ledger',
  );
  await assert.rejects(
    client.query('DELETE FROM notification_outbox WHERE source_event_id = $1', [exact.eventId]),
    (error) => error.code === 'P0001',
    'DELETE is rejected by the append-only ledger',
  );

  const audienceIds = expected.audience.userIds;
  const audienceValidity = (await client.query(
    `SELECT notification_outbox_user_ids_valid($1::jsonb) AS sorted,
            notification_outbox_user_ids_valid($2::jsonb) AS duplicated,
            notification_outbox_user_ids_valid($3::jsonb) AS unsorted,
            notification_outbox_user_ids_valid($4::jsonb) AS non_string`,
    [
      JSON.stringify(audienceIds),
      JSON.stringify([audienceIds[0], audienceIds[0]]),
      JSON.stringify([...audienceIds].reverse()),
      JSON.stringify([{ userId: audienceIds[0] }]),
    ],
  )).rows[0];
  assert.deepEqual(audienceValidity, {
    sorted: true, duplicated: false, unsorted: false, non_string: false,
  }, 'schema accepts only sorted/deduplicated lowercase UUID strings');

  const malformed = await seedStatusChange(client, {
    label: 'malformed-null',
    occurredAt: '2026-09-01T12:35:00.000001Z',
  });
  fixtures.push(malformed);
  const nullRoleEnvelope = expectedEnvelope(malformed, {
    actor: { userId: malformed.actorUserId.toLowerCase(), role: null },
  });
  await assert.rejects(
    client.query(
      `INSERT INTO notification_outbox
         (source_event_id, occurred_at, immutable_envelope, immutable_digest)
       SELECT id, at, $2::jsonb, $3::bytea FROM ride_events WHERE id = $1`,
      [
        malformed.eventId,
        nullRoleEnvelope,
        createHash('sha256').update(jcs(nullRoleEnvelope), 'utf8').digest(),
      ],
    ),
    (error) => error.code === '23514',
    'semantic JSON null is rejected rather than passing CHECK as SQL UNKNOWN',
  );

  const collision = await seedStatusChange(client, {
    label: 'collision',
    occurredAt: '2026-09-01T12:35:56.654321Z',
  });
  fixtures.push(collision);
  const conflictingEnvelope = expectedEnvelope(collision, {
    aggregate: {
      type: 'ride',
      id: collision.rideId.toLowerCase(),
      key: `${collision.tripId}-different`,
    },
  });
  await client.query(
    `INSERT INTO notification_outbox
       (source_event_id, occurred_at, immutable_envelope, immutable_digest)
     SELECT id, at, $2::jsonb, $3::bytea FROM ride_events WHERE id = $1`,
    [
      collision.eventId,
      conflictingEnvelope,
      createHash('sha256').update(jcs(conflictingEnvelope), 'utf8').digest(),
    ],
  );
  const collisionBefore = (await client.query(
    `SELECT outbox_seq::text AS event_seq, immutable_envelope,
            encode(immutable_digest, 'hex') AS immutable_digest
       FROM notification_outbox WHERE source_event_id = $1`,
    [collision.eventId],
  )).rows[0];
  await assert.rejects(
    withTransaction(client, (tx) => insertRideStatusNotificationOutbox(tx, {
      sourceEventId: collision.eventId,
      actorUserId: collision.actorUserId,
      actorRole: collision.actorRole,
    })),
    (error) => error.code === 'NOTIFICATION_OUTBOX_SOURCE_COLLISION',
    'different immutable content for one source is a hard collision',
  );
  const collisionAfter = (await client.query(
    `SELECT outbox_seq::text AS event_seq, immutable_envelope,
            encode(immutable_digest, 'hex') AS immutable_digest
       FROM notification_outbox WHERE source_event_id = $1`,
    [collision.eventId],
  )).rows[0];
  assert.deepEqual(collisionAfter, collisionBefore, 'collision never overwrites the original row');

  const deduplicated = await seedStatusChange(client, {
    label: 'deduplicated-audience',
    occurredAt: '2026-09-01T12:36:56.000001Z',
    sameParticipant: true,
  });
  fixtures.push(deduplicated);
  const deduplicatedResult = await withTransaction(
    client,
    (tx) => insertRideStatusNotificationOutbox(tx, {
      sourceEventId: deduplicated.eventId,
      actorUserId: deduplicated.actorUserId,
      actorRole: deduplicated.actorRole,
    }),
  );
  assert.deepEqual(
    deduplicatedResult.envelope.audience.userIds,
    [deduplicated.actorUserId.toLowerCase()],
    'a self-participant Ride freezes one sorted/deduplicated audience ID',
  );
});

test('notification outbox: a PostgreSQL insert failure rolls back Ride + event + outbox', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const inspect = new pg.Client({ connectionString: DATABASE_URL });
  const identity = nextIdentity('rollback');
  const fixtures = [];
  const originalTx = app.db.tx;
  await inspect.connect();
  t.after(async () => {
    app.db.tx = originalTx;
    await cleanupFixtures(inspect, fixtures).catch(() => {});
    await inspect.end();
    await app.close();
  });

  const passenger = await mintSession(app, identity.passengerPhone);
  const driver = await mintSession(app, identity.driverPhone);
  const ride = (await inspect.query(
    `INSERT INTO rides
       (trip_id, status, role, passenger_user_id, driver_user_id)
     VALUES ($1, 'ACCEPTED', 'driver', $2, $3)
     RETURNING id::text`,
    [identity.tripId, passenger.user.userId, driver.user.userId],
  )).rows[0];
  fixtures.push({
    ...identity,
    passengerUserId: passenger.user.userId,
    driverUserId: driver.user.userId,
    rideId: ride.id,
  });

  app.db.tx = async (fn) => originalTx(async (client) => {
    const proxy = new Proxy(client, {
      get(target, property, receiver) {
        if (property === 'query') {
          return async (...args) => {
            const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
            if (/INSERT\s+INTO\s+notification_outbox/i.test(sql ?? '')) {
              // A real SQL error on this same session marks the transaction aborted. The normal
              // db.tx catch path must ROLLBACK it; no global test trigger or shared DDL is needed.
              return target.query('SELECT 1/0 /* forced notification outbox failure */');
            }
            return target.query(...args);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    return fn(proxy);
  });

  const failed = await patch(
    app,
    `/api/v1/ride-state/rides/${identity.tripId}/status`,
    { status: 'DRIVER_EN_ROUTE' },
    bearer(driver),
  );
  assert.equal(failed.statusCode, 500);
  assert.deepEqual(failed.json(), {
    error: 'internal server error', code: 'INTERNAL', retryable: true,
  });
  const rolledBack = (await inspect.query(
    `SELECT r.status, r.accepted_at,
            (SELECT count(*)::int FROM ride_events e WHERE e.trip_id = r.trip_id) AS event_count,
            (SELECT count(*)::int FROM notification_outbox o
              WHERE o.immutable_envelope #>> '{aggregate,key}' = r.trip_id) AS outbox_count
       FROM rides r WHERE r.trip_id = $1`,
    [identity.tripId],
  )).rows[0];
  assert.deepEqual(rolledBack, {
    status: 'ACCEPTED', accepted_at: null, event_count: 0, outbox_count: 0,
  }, 'all three writes roll back together');

  app.db.tx = originalTx;
  const retry = await patch(
    app,
    `/api/v1/ride-state/rides/${identity.tripId}/status`,
    { status: 'DRIVER_EN_ROUTE' },
    bearer(driver),
  );
  assert.equal(retry.statusCode, 200);
  const committed = (await inspect.query(
    `SELECT r.status, r.accepted_at IS NOT NULL AS accepted,
            (SELECT count(*)::int FROM ride_events e WHERE e.trip_id = r.trip_id) AS event_count,
            (SELECT count(*)::int FROM notification_outbox o
              WHERE o.immutable_envelope #>> '{aggregate,key}' = r.trip_id) AS outbox_count
       FROM rides r WHERE r.trip_id = $1`,
    [identity.tripId],
  )).rows[0];
  assert.deepEqual(committed, {
    status: 'DRIVER_EN_ROUTE', accepted: true, event_count: 1, outbox_count: 1,
  });
});

test('notification outbox: a lower sequence may commit after a visible higher sequence', { skip: SKIP }, async (t) => {
  const a = new pg.Client({ connectionString: DATABASE_URL });
  const b = new pg.Client({ connectionString: DATABASE_URL });
  const observer = new pg.Client({ connectionString: DATABASE_URL });
  const fixtures = [];
  let aOpen = false;
  let bOpen = false;
  await Promise.all([a.connect(), b.connect(), observer.connect()]);
  t.after(async () => {
    if (aOpen) await a.query('ROLLBACK').catch(() => {});
    if (bOpen) await b.query('ROLLBACK').catch(() => {});
    await cleanupFixtures(observer, fixtures).catch(() => {});
    await Promise.all([a.end(), b.end(), observer.end()]);
  });

  const sourceA = await seedStatusChange(observer, {
    label: 'late-a', occurredAt: '2026-09-01T13:00:00.000001Z',
  });
  const sourceB = await seedStatusChange(observer, {
    label: 'late-b', occurredAt: '2026-09-01T13:00:00.000002Z',
  });
  fixtures.push(sourceA, sourceB);

  await a.query('BEGIN');
  aOpen = true;
  const low = await insertRideStatusNotificationOutbox(a, {
    sourceEventId: sourceA.eventId,
    actorUserId: sourceA.actorUserId,
    actorRole: sourceA.actorRole,
  });

  await b.query('BEGIN');
  bOpen = true;
  const high = await insertRideStatusNotificationOutbox(b, {
    sourceEventId: sourceB.eventId,
    actorUserId: sourceB.actorUserId,
    actorRole: sourceB.actorRole,
  });
  assert.ok(BigInt(high.eventSeq) > BigInt(low.eventSeq), 'sequence allocation follows insert order');

  await b.query('COMMIT');
  bOpen = false;
  const afterHighCommit = (await observer.query(
    `SELECT source_event_id::text, outbox_seq::text AS event_seq
       FROM notification_outbox WHERE source_event_id = ANY($1::uuid[])
       ORDER BY outbox_seq`,
    [[sourceA.eventId, sourceB.eventId]],
  )).rows;
  assert.deepEqual(afterHighCommit, [{
    source_event_id: sourceB.eventId, event_seq: high.eventSeq,
  }], 'observer sees the committed higher sequence while the lower one is still invisible');

  await a.query('COMMIT');
  aOpen = false;
  const afterLateLowCommit = (await observer.query(
    `SELECT source_event_id::text, outbox_seq::text AS event_seq
       FROM notification_outbox WHERE source_event_id = ANY($1::uuid[])
       ORDER BY outbox_seq`,
    [[sourceA.eventId, sourceB.eventId]],
  )).rows;
  assert.deepEqual(afterLateLowCommit, [
    { source_event_id: sourceA.eventId, event_seq: low.eventSeq },
    { source_event_id: sourceB.eventId, event_seq: high.eventSeq },
  ], 'the lower sequence remains discoverable after it commits late');
});
