// /server/test/realtime-flow.test.mjs — DB-gated end-to-end for R09 (#9 realtime read seam) through
// the real Fastify app + real Postgres. Builds a ride via the live spine, drives status transitions
// (which append ride_events), and polls /api/v1/realtime/poll — verifying the DB-cursor delta
// (events since `since`), the cursor advancing, and participant gating. SKIPPED without DATABASE_URL;
// runs in server-ci. Cleanup drops the append-only ride_events past the no-mutation/RESTRICT guards
// (CI superuser), best-effort.
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
const pollUrl = (tripId, since) => `/api/v1/realtime/poll?tripId=${encodeURIComponent(tripId)}${since ? `&since=${encodeURIComponent(since)}` : ''}`;

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

test('realtime poll: DB-cursor delta over the ride timeline + participant gating', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1621${String(process.pid).padStart(7, '0')}`;
  const drv = `+1622${String(process.pid).padStart(7, '0')}`;
  const other = `+1623${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  const tripIds = [];
  t.after(async () => {
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    if (tripIds.length) {
      await cleanup.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    }
    await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, drv, other]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  // build a ride via the live spine, then advance its status (appending ride_events).
  const paxS = await mintSession(app, pax);
  const drvS = await mintSession(app, drv);
  const otherS = await mintSession(app, other);
  const order = (await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  const off = (await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'Иван' }, bearer(drvS))).json().offer;
  const tripId = (await post(app, '/api/v1/matching/select', { orderId: order.id, driverId: off.driverId }, bearer(paxS))).json().ride.tripId;
  tripIds.push(tripId);
  await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status: 'IN_PROGRESS' }, bearer(drvS));

  // first poll (no cursor): the IN_PROGRESS transition event + current status + a cursor.
  const p1 = await get(app, pollUrl(tripId), bearer(paxS));
  assert.equal(p1.statusCode, 200);
  assert.equal(p1.json().status, 'IN_PROGRESS');
  assert.equal(p1.json().events.length, 1, 'one status_change since the bootstrap');
  assert.equal(p1.json().events[0].type, 'status_change');
  assert.equal(p1.json().events[0].payload.to, 'IN_PROGRESS');
  assert.ok(p1.json().cursor, 'a cursor is returned');

  // poll with that cursor: nothing new, cursor unchanged.
  const p2 = await get(app, pollUrl(tripId, p1.json().cursor), bearer(paxS));
  assert.equal(p2.json().events.length, 0, 'no new events since the cursor');
  assert.equal(p2.json().cursor, p1.json().cursor, 'cursor unchanged when nothing new');

  // a new transition appears in the delta from the old cursor.
  await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status: 'COMPLETED' }, bearer(drvS));
  const p3 = await get(app, pollUrl(tripId, p1.json().cursor), bearer(paxS));
  assert.equal(p3.json().events.length, 1, 'the COMPLETED transition is in the delta');
  assert.equal(p3.json().events[0].payload.to, 'COMPLETED');
  assert.equal(p3.json().status, 'COMPLETED');

  // gating: anon 401, non-participant 403, unknown trip 404.
  assert.equal((await get(app, pollUrl(tripId))).statusCode, 401, 'anon cannot poll');
  assert.equal((await get(app, pollUrl(tripId), bearer(otherS))).statusCode, 403, 'non-participant cannot poll');
  assert.equal((await get(app, pollUrl('trip-nope'), bearer(drvS))).statusCode, 404, 'unknown trip -> 404');
  // a since that passes schema validation but pg's timestamptz rejects (Feb 30) is a clean 400, never a 500.
  assert.equal((await get(app, pollUrl(tripId, '2026-02-30T00:00:00Z'), bearer(paxS))).statusCode, 400, 'pg-invalid since cursor -> 400');
});
