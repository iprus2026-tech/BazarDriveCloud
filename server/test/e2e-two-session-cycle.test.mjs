// /server/test/e2e-two-session-cycle.test.mjs — BD-E2E-MULTIDEVICE-01 (#831, part of #820): the
// COMPOSED two-session pilot cycle through the real Fastify app + real Postgres. One passenger
// session and one driver session (separate identities) run the whole server-owned flow:
//   OTP auth (x2) -> POST /orders -> driver sees it in GET /orders -> offer (+ idempotent replay)
//   -> owner-only offer list -> /select (assignment + R10 ride bootstrap) -> second select 409
//   -> PATCH chain DRIVER_EN_ROUTE -> DRIVER_APPROACHING_PICKUP -> WAITING_PASSENGER ->
//   IN_PROGRESS -> COMPLETED -> terminal freeze -> write-once receipt -> GET /history (both
//   roles) -> realtime poll (cursor round-trip) -> chat thread. A second test pins the NO_SHOW
//   terminal branch.
//
// WHY this exists alongside the per-resource flows (orders/matching/select/ride-state/history/
// realtime/chat-flow): those pin each route in isolation; THIS pins the composition, so the
// upcoming auth/idempotency contract PRs (#825 chat auth, #826 idempotency, #829 session
// lifecycle, #830 role policy) cannot silently break the end-to-end cycle. When those land,
// UPDATE the marked assertions here — never delete the cycle.
//
// TODO(#825): the chat section deliberately asserts TODAY's contract — /api/v1/chat/messages is
// NOT 401-gated and trusts senderRole from the body (services/chat/index.js declares this as the
// pre-R17 minimal cross-device proof). When BD-CHAT-AUTH-01 lands, flip those assertions to the
// authenticated-participant contract in the same PR.
//
// SKIPPED without DATABASE_URL; runs in server-ci's app job. Unique per-process phones; cleans up
// in t.after() (receipts -> ride_events -> rides with triggers relaxed, then orders — cascades
// offers + assignment — then messages/users/auth_otp).
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
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json(); // { token, user }
}

// One driver advance on the single terminal-freeze write path (#5), asserting the status and the
// status-keyed lifecycle timestamp that domain/ride-status.js STATUS_TIMESTAMP_FIELD stamps.
async function advance(app, session, tripId, status, tsKey) {
  const res = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status }, bearer(session));
  assert.equal(res.statusCode, 200, `PATCH -> ${status}`);
  const ride = res.json().ride;
  assert.equal(ride.status, status);
  if (tsKey) assert.ok(ride.timestamps[tsKey], `${status} stamps timestamps.${tsKey}`);
  return ride;
}

test('two-session pilot cycle: auth -> order -> offer -> select -> ride -> COMPLETED -> receipt/history/poll/chat', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1631${String(process.pid).padStart(7, '0')}`;
  const drv = `+1632${String(process.pid).padStart(7, '0')}`;
  const out = `+1633${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  const chatIds = [];
  t.after(async () => {
    const tripIds = orderIds.map((id) => `trip_${id}`);
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    if (tripIds.length) {
      await cleanup.query('DELETE FROM receipts WHERE ride_id IN (SELECT id FROM rides WHERE trip_id = ANY($1))', [tripIds]).catch(() => {});
      await cleanup.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    }
    await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {}); // cascades offers + assignment
    if (chatIds.length) await cleanup.query('DELETE FROM messages WHERE chat_id = ANY($1)', [chatIds]).catch(() => {});
    for (const p of [pax, drv, out]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  // ---- 1. Two devices, two DISTINCT identities (never the shared pseudo-id of the mock era).
  const paxS = await mintSession(app, pax);
  const drvS = await mintSession(app, drv);
  const outS = await mintSession(app, out);
  assert.ok(paxS.token && drvS.token, 'both sessions minted');
  assert.notEqual(paxS.user.userId, drvS.user.userId, 'passenger and driver are separate identities');

  // ---- 2. Passenger publishes the order; anonymous create is rejected.
  assert.equal((await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Аэропорт' } })).statusCode, 401);
  const orderRes = await post(app, '/api/v1/orders', {
    type: 'ride_order', source: 'map',
    pickup: { label: 'Дом' }, dropoff: { label: 'Аэропорт' },
    distanceKm: 12.4, durationMin: 25, estimatedPrice: 900, estimatedPriceLabel: '900 ₽',
  }, bearer(paxS));
  assert.equal(orderRes.statusCode, 201);
  const order = orderRes.json().order;
  orderIds.push(order.id);
  assert.equal(order.status, 'CREATED');

  // ---- 3. The driver's device sees the open order in the shared feed read.
  const feed = (await get(app, '/api/v1/orders', bearer(drvS))).json();
  assert.ok(feed.items.some((o) => o.id === order.id), 'driver sees the passenger order');

  // ---- 4. Offer + idempotent replay (the retry path): same (order, driver) key, same offer id.
  const offerBody = { orderId: order.id, driverName: 'Иван', car: 'Kia Rio', rating: '4,9', etaMin: 5, price: 850, message: 'еду' };
  const off1 = await post(app, '/api/v1/matching/offers', offerBody, bearer(drvS));
  assert.equal(off1.statusCode, 201);
  const off2 = await post(app, '/api/v1/matching/offers', offerBody, bearer(drvS));
  // TODO(#826): today an idempotent replay answers 201 like the first write; if the idempotency
  // contract standardizes the replay status, update the code here — the ID equality is the invariant.
  assert.equal(off2.json().offer.id, off1.json().offer.id, 'offer replay is idempotent per (order, driver)');

  // ---- 5. Offer list is OWNER-only: passenger 200, driver/outsider 403 (authority isolation).
  const offersUrl = `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`;
  assert.equal((await get(app, offersUrl, bearer(paxS))).statusCode, 200);
  assert.equal((await get(app, offersUrl, bearer(drvS))).statusCode, 403);
  assert.equal((await get(app, offersUrl, bearer(outS))).statusCode, 403);

  // ---- 6. Select: only the owner may select; the transactional accept mints the ride (R10).
  const selectBody = { orderId: order.id, driverId: off1.json().offer.driverId };
  assert.equal((await post(app, '/api/v1/matching/select', selectBody, bearer(drvS))).statusCode, 403, 'non-owner cannot select');
  const sel = await post(app, '/api/v1/matching/select', selectBody, bearer(paxS));
  assert.equal(sel.statusCode, 200);
  const { assignment, ride: ride0 } = sel.json();
  assert.equal(sel.json().order.status, 'ACCEPTED');
  assert.equal(assignment.status, 'ACCEPTED');
  assert.equal(ride0.tripId, `trip_${order.id}`, 'deterministic tripId links order -> ride');
  assert.equal(ride0.status, 'DRIVER_EN_ROUTE');
  assert.ok(ride0.timestamps.acceptedAt, 'select stamps acceptedAt');
  assert.equal(ride0.order.offerPrice, '850 ₽', 'agreed fare = the accepted bid');
  const tripId = ride0.tripId;

  // ---- 7. Concurrency guard: a second select of the same order loses deterministically.
  const sel2 = await post(app, '/api/v1/matching/select', selectBody, bearer(paxS));
  assert.equal(sel2.statusCode, 409);
  assert.equal(sel2.json().code, 'ORDER_NOT_OPEN');
  // The accepted order leaves the open feed, so another driver can no longer discover it.
  const feedAfter = (await get(app, '/api/v1/orders', bearer(drvS))).json();
  assert.ok(!feedAfter.items.some((o) => o.id === order.id), 'accepted order leaves the CREATED feed');

  // ---- 8. Snapshot isolation: both participants read the ride; outsider 403; anonymous 401.
  const rideUrl = `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}`;
  assert.equal((await get(app, rideUrl, bearer(paxS))).statusCode, 200);
  assert.equal((await get(app, rideUrl, bearer(drvS))).statusCode, 200);
  assert.equal((await get(app, rideUrl, bearer(outS))).statusCode, 403);
  assert.equal((await get(app, rideUrl)).statusCode, 401);

  // ---- 9. Driver advances the lifecycle; each hop stamps its status-keyed timestamp.
  await advance(app, drvS, tripId, 'DRIVER_APPROACHING_PICKUP', 'approachingAt');
  await advance(app, drvS, tripId, 'WAITING_PASSENGER', 'arrivedAt');
  const inProg = await advance(app, drvS, tripId, 'IN_PROGRESS', 'startedAt');

  // A receipt is a post-completion document — refused mid-ride.
  assert.equal((await post(app, '/api/v1/history/receipts',
    { tripId, fare: 850, commission: -85, tip: 0, net: 765 }, bearer(drvS))).statusCode, 409, 'no receipt before COMPLETED');

  // Same-status re-PATCH (a network retry) is a no-op: no re-stamp, no event (asserted via poll below).
  const noop = await patch(app, `${rideUrl}/status`, { status: 'IN_PROGRESS' }, bearer(drvS));
  assert.equal(noop.statusCode, 200);
  assert.equal(noop.json().ride.timestamps.startedAt, inProg.timestamps.startedAt, 'retry does not re-stamp startedAt');

  // An outsider can never drive the transition.
  assert.equal((await patch(app, `${rideUrl}/status`, { status: 'COMPLETED' }, bearer(outS))).statusCode, 403);

  // ---- 10. Completion + terminal freeze (both directions).
  const done = await advance(app, drvS, tripId, 'COMPLETED', 'completedAt');
  const out409 = await patch(app, `${rideUrl}/status`, { status: 'IN_PROGRESS' }, bearer(drvS));
  assert.equal(out409.statusCode, 409);
  assert.equal(out409.json().code, 'RIDE_TERMINAL', 'terminal ride cannot move OUT');
  const reDone = await patch(app, `${rideUrl}/status`, { status: 'COMPLETED' }, bearer(drvS));
  assert.equal(reDone.statusCode, 200, 'terminal same-status retry stays an idempotent no-op');
  assert.equal(reDone.json().ride.timestamps.completedAt, done.timestamps.completedAt);

  // ---- 11. Realtime poll: participant-gated; exactly the 4 driver transitions; cursor round-trips.
  const pollUrl = `/api/v1/realtime/poll?tripId=${encodeURIComponent(tripId)}`;
  assert.equal((await get(app, pollUrl)).statusCode, 401);
  assert.equal((await get(app, pollUrl, bearer(outS))).statusCode, 403);
  const poll = (await get(app, pollUrl, bearer(paxS))).json();
  assert.equal(poll.status, 'COMPLETED');
  assert.equal(poll.events.length, 4, '4 transitions -> 4 status_change events (no-ops appended none)');
  assert.ok(poll.events.every((e) => e.type === 'status_change' && e.role === 'driver'));
  assert.ok(poll.cursor, 'poll returns a cursor');
  const incr = (await get(app, `${pollUrl}&since=${encodeURIComponent(poll.cursor)}`, bearer(paxS))).json();
  assert.equal(incr.events.length, 0, 'nothing new after the cursor');
  assert.equal(incr.cursor, poll.cursor, 'cursor is stable when nothing new');
  assert.equal((await get(app, `${pollUrl}&since=2026-02-30T00:00:00Z`, bearer(paxS))).statusCode, 400, 'malformed cursor is a clean 400');

  // ---- 12. Chat thread over the shared messages table, with clientMsgId dedup.
  // TODO(#825): asserted per TODAY's contract — no 401 gate, senderRole from the body (see header).
  const chatId = `trip-${tripId}`;
  chatIds.push(chatId);
  const m1 = await post(app, '/api/v1/chat/messages', { chatId, body: 'Я на месте', senderRole: 'driver', clientMsgId: 1 });
  assert.equal(m1.statusCode, 201);
  const m1re = await post(app, '/api/v1/chat/messages', { chatId, body: 'Я на месте', senderRole: 'driver', clientMsgId: 1 });
  assert.equal(m1re.json().message.id, m1.json().message.id, 'clientMsgId re-send dedups to the original row');
  const m2 = await post(app, '/api/v1/chat/messages', { chatId, body: 'Выхожу', senderRole: 'passenger', clientMsgId: 1 });
  assert.notEqual(m2.json().message.id, m1.json().message.id, 'dedup is per (chat, senderRole, clientMsgId)');
  const thread = (await get(app, `/api/v1/chat/messages?chatId=${encodeURIComponent(chatId)}`)).json();
  assert.deepEqual(thread.items.map((m) => m.body), ['Я на месте', 'Выхожу'], 'one shared chronological thread');

  // ---- 13. Write-once receipt (driver-only), then history for BOTH roles.
  assert.equal((await post(app, '/api/v1/history/receipts',
    { tripId, fare: 850, commission: -85, tip: 0, net: 765 }, bearer(paxS))).statusCode, 403, 'passenger cannot write the receipt');
  const rec = await post(app, '/api/v1/history/receipts',
    { tripId, fare: 850, commission: -85, tip: 0, net: 765, paymentMode: 'cash' }, bearer(drvS));
  assert.equal(rec.statusCode, 201);
  const recAgain = await post(app, '/api/v1/history/receipts',
    { tripId, fare: 999, commission: 0, tip: 0, net: 999 }, bearer(drvS));
  assert.equal(recAgain.statusCode, 201);
  assert.equal(recAgain.json().receipt.fare, 850, 'write-once: a second write returns the ORIGINAL amounts');
  assert.equal(recAgain.json().receipt.net, 765);

  assert.equal((await get(app, '/api/v1/history')).statusCode, 401);
  const paxHist = (await get(app, '/api/v1/history', bearer(paxS))).json();
  const pe = paxHist.items.find((e) => e.tripId === tripId);
  assert.ok(pe, 'passenger history has the trip');
  assert.equal(pe.role, 'passenger');
  assert.equal(pe.counterparty.name, 'Иван', 'passenger sees the driver');
  const drvHist = (await get(app, '/api/v1/history', bearer(drvS))).json();
  const de = drvHist.items.find((e) => e.tripId === tripId);
  assert.ok(de, 'driver history has the trip');
  assert.equal(de.role, 'driver');
  assert.equal(de.counterparty.name, 'Пассажир', 'driver sees the passenger');
  assert.equal(de.receipt && de.receipt.net, 765, 'driver history carries the receipt');
  const outHist = (await get(app, '/api/v1/history', bearer(outS))).json();
  assert.ok(!outHist.items.some((e) => e.tripId === tripId), 'outsider history never sees the trip');
});

test('NO_SHOW terminal branch: waiting -> NO_SHOW freezes the ride; no receipt is possible', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const pax = `+1634${String(process.pid).padStart(7, '0')}`;
  const drv = `+1635${String(process.pid).padStart(7, '0')}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  const orderIds = [];
  t.after(async () => {
    const tripIds = orderIds.map((id) => `trip_${id}`);
    await cleanup.query("SET session_replication_role = 'replica'").catch(() => {});
    if (tripIds.length) {
      await cleanup.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
      await cleanup.query('DELETE FROM rides WHERE trip_id = ANY($1)', [tripIds]).catch(() => {});
    }
    await cleanup.query("SET session_replication_role = 'origin'").catch(() => {});
    if (orderIds.length) await cleanup.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of [pax, drv]) {
      await cleanup.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await cleanup.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await cleanup.end();
    await app.close();
  });

  const paxS = await mintSession(app, pax);
  const drvS = await mintSession(app, drv);
  const order = (await post(app, '/api/v1/orders',
    { pickup: { label: 'Рынок' }, dropoff: { label: 'Вокзал' } }, bearer(paxS))).json().order;
  orderIds.push(order.id);
  await post(app, '/api/v1/matching/offers', { orderId: order.id, driverName: 'Пётр', price: 500 }, bearer(drvS));
  const sel = await post(app, '/api/v1/matching/select',
    { orderId: order.id, driverId: (await get(app, `/api/v1/matching/offers?orderId=${encodeURIComponent(order.id)}`, bearer(paxS))).json().items[0].driverId },
    bearer(paxS));
  assert.equal(sel.statusCode, 200);
  const tripId = sel.json().ride.tripId;

  await advance(app, drvS, tripId, 'DRIVER_APPROACHING_PICKUP', 'approachingAt');
  await advance(app, drvS, tripId, 'WAITING_PASSENGER', 'arrivedAt');
  const noShow = await advance(app, drvS, tripId, 'NO_SHOW', 'canceledAt');
  assert.equal(noShow.status, 'NO_SHOW');

  // Terminal freeze: the no-show ride can never resume…
  const resume = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(tripId)}/status`, { status: 'IN_PROGRESS' }, bearer(drvS));
  assert.equal(resume.statusCode, 409);
  assert.equal(resume.json().code, 'RIDE_TERMINAL');
  // …and only a COMPLETED ride may have a receipt.
  assert.equal((await post(app, '/api/v1/history/receipts',
    { tripId, fare: 500, commission: -50, tip: 0, net: 450 }, bearer(drvS))).statusCode, 409, 'no receipt for a NO_SHOW ride');
  // The realtime poll reports the terminal truth to the passenger's device.
  const poll = (await get(app, `/api/v1/realtime/poll?tripId=${encodeURIComponent(tripId)}`, bearer(paxS))).json();
  assert.equal(poll.status, 'NO_SHOW');
  assert.equal(poll.events.length, 3);
});
