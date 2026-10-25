// /server/test/chat-flow.test.mjs — DB-gated end-to-end for chat through the real Fastify app + real
// Postgres. Since BD-CHAT-AUTH-01 (#825, owner's decisions R1–R5) chat is authorized by ride
// participation:
//   - only 'trip-<tripId>' of a real ride, only its passenger and driver;
//   - the sender role comes from the session, not the body;
//   - 401 without a session; the same 404 CHAT_NOT_FOUND for someone else's and an unknown thread;
//   - 409 CHAT_CLOSED once the ride is terminal (reading stays);
//   - 30 messages a minute per sender in a thread (429 + Retry-After);
//   - clientMsgId re-sends stay idempotent.
// SKIPPED without DATABASE_URL; runs in server-ci. Unique per-process phones; cleanup in t.after().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { buildApp } from '../src/server.js';
import { listMessagesByChat } from '../src/repositories/messages.js';
import { grantDriverRole } from '../test-support/driver-grant.mjs';

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
const bearer = (s) => (s ? { authorization: `Bearer ${s.token}` } : {});
const thread = (chatId) => `/api/v1/chat/messages?chatId=${encodeURIComponent(chatId)}`;
const send = (app, s, payload) => post(app, '/api/v1/chat/messages', payload, bearer(s));

async function mintSession(app, phone) {
  const code = (await post(app, '/api/v1/auth/otp/request', { phone })).json().devCode;
  return (await post(app, '/api/v1/auth/otp/verify', { phone, code })).json();
}

// order -> offer -> select: a real ride with a passenger and a driver (status DRIVER_EN_ROUTE).
async function acceptedRide(app, db, pax, drv) {
  const paxS = await mintSession(app, pax);
  const orderId = (await post(app, '/api/v1/orders', { pickup: { label: 'Дом' }, dropoff: { label: 'Центр' } }, bearer(paxS))).json().order.id;
  const drvS = await grantDriverRole(db, await mintSession(app, drv));
  assert.equal((await post(app, '/api/v1/matching/offers', { vehiclePlate: 'А 123 ВС 77', orderId, price: 700 }, bearer(drvS))).statusCode, 201);
  assert.equal((await post(app, '/api/v1/matching/select', { orderId, driverId: drvS.user.userId }, bearer(paxS))).statusCode, 200);
  const tripId = `trip_${orderId}`;
  return { paxS, drvS, orderId, tripId, chatId: `trip-${tripId}` };
}

async function fixture(t, phones) {
  const app = await buildApp({ config });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  const orderIds = [];
  t.after(async () => {
    const trips = orderIds.map((id) => `trip_${id}`);
    await db.query('DELETE FROM messages WHERE chat_id = ANY($1)', [trips.map((tr) => `trip-${tr}`)]).catch(() => {});
    await db.query('DELETE FROM ride_events WHERE trip_id = ANY($1)', [trips]).catch(() => {});
    await db.query('DELETE FROM rides WHERE trip_id = ANY($1)', [trips]).catch(() => {});
    await db.query('DELETE FROM orders WHERE legacy_id = ANY($1)', [orderIds]).catch(() => {});
    for (const p of phones) {
      await db.query('DELETE FROM users WHERE phone = $1', [p]).catch(() => {});
      await db.query('DELETE FROM auth_otp WHERE phone = $1', [p]).catch(() => {});
    }
    await db.end();
    await app.close();
  });
  const ride = async (pax, drv) => {
    const r = await acceptedRide(app, db, pax, drv);
    orderIds.push(r.orderId);
    return r;
  };
  return { app, db, ride };
}

const tag = String(process.pid).padStart(7, '0');
const phone = (group, i) => `+184${group}${tag}${i}`;

test('chat: the two participants share one thread; the role is the server\'s; clientMsgId stays idempotent', { skip: SKIP }, async (t) => {
  const { app, db, ride } = await fixture(t, [phone(0, 0), phone(0, 1)]);
  const r = await ride(phone(0, 0), phone(0, 1));

  assert.deepEqual((await get(app, thread(r.chatId), bearer(r.paxS))).json(), { items: [] });

  // The passenger claims to be the driver: the server stamps the passenger role anyway (R2).
  const a = await send(app, r.paxS, { chatId: r.chatId, body: 'Еду', senderRole: 'driver', clientMsgId: 1001, displayTime: '14:21' });
  assert.equal(a.statusCode, 201);
  assert.equal(a.json().message.senderRole, 'passenger', 'the body senderRole is ignored');
  assert.equal(a.json().message.body, 'Еду');

  // A re-send with the same clientMsgId (and another body) returns the original.
  const aDup = await send(app, r.paxS, { chatId: r.chatId, body: 'Еду (retry)', clientMsgId: 1001 });
  assert.equal(aDup.statusCode, 201);
  assert.equal(aDup.json().message.id, a.json().message.id);
  assert.equal(aDup.json().message.body, 'Еду');

  // The driver, with no senderRole at all, writes as the driver; the same clientMsgId is a new row.
  const b = await send(app, r.drvS, { chatId: r.chatId, body: 'Подъезжаю', clientMsgId: 1001 });
  assert.equal(b.statusCode, 201);
  assert.equal(b.json().message.senderRole, 'driver');
  assert.notEqual(b.json().message.id, a.json().message.id);

  for (const s of [r.paxS, r.drvS]) {
    const items = (await get(app, thread(r.chatId), bearer(s))).json().items;
    assert.deepEqual(items.map((m) => [m.senderRole, m.body]), [['passenger', 'Еду'], ['driver', 'Подъезжаю']]);
  }
  const stored = await db.query('SELECT DISTINCT ride_id FROM messages WHERE chat_id = $1', [r.chatId]);
  const rideRow = await db.query('SELECT id FROM rides WHERE trip_id = $1', [r.tripId]);
  assert.deepEqual(stored.rows.map((row) => row.ride_id), [rideRow.rows[0].id], 'a message records its ride');

  // The repo keeps the most RECENT window, chronological (Codex #796 P2).
  const recent = await listMessagesByChat(db, r.chatId, { limit: 1 });
  assert.deepEqual(recent.map((m) => m.body), ['Подъезжаю']);

  // Validation still comes first.
  assert.equal((await send(app, r.paxS, { chatId: r.chatId, body: '' })).statusCode, 400);
  assert.equal((await send(app, r.paxS, { body: 'x' })).statusCode, 400);
});

test('chat: 401 without a session; the same 404 for someone else\'s, an unknown and a non-ride thread', { skip: SKIP }, async (t) => {
  const { app, ride } = await fixture(t, [phone(1, 0), phone(1, 1), phone(1, 2)]);
  const r = await ride(phone(1, 0), phone(1, 1));
  const outsider = await mintSession(app, phone(1, 2));

  for (const res of [await get(app, thread(r.chatId)), await send(app, null, { chatId: r.chatId, body: 'x' })]) {
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'UNAUTHENTICATED');
  }
  const notFound = [];
  for (const chatId of [r.chatId, `trip-trip_${r.orderId}-nope`, `response-resp_${r.orderId}`, 'demo', r.tripId]) {
    notFound.push(await get(app, thread(chatId), bearer(outsider)));
    notFound.push(await send(app, outsider, { chatId, body: 'x' }));
  }
  // A participant asking for a thread that is not a ride gets the same answer.
  notFound.push(await get(app, thread(`response-resp_${r.orderId}`), bearer(r.paxS)));
  notFound.push(await send(app, r.drvS, { chatId: 'demo', body: 'x' }));
  for (const res of notFound) {
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: 'chat not found', code: 'CHAT_NOT_FOUND', retryable: false });
  }
  assert.equal((await get(app, thread(r.chatId), bearer(r.paxS))).json().items.length, 0, 'nothing was written');
});

test('chat: once the ride is terminal, writing is 409 CHAT_CLOSED and reading stays', { skip: SKIP }, async (t) => {
  const { app, ride } = await fixture(t, [phone(2, 0), phone(2, 1)]);
  const r = await ride(phone(2, 0), phone(2, 1));
  assert.equal((await send(app, r.drvS, { chatId: r.chatId, body: 'Подъезжаю' })).statusCode, 201);
  const cancel = await patch(app, `/api/v1/ride-state/rides/${encodeURIComponent(r.tripId)}/status`,
    { status: 'CANCELED', cancel: { reason: 'changed_mind' } }, bearer(r.paxS));
  assert.equal(cancel.statusCode, 200);
  for (const s of [r.paxS, r.drvS]) {
    const res = await send(app, s, { chatId: r.chatId, body: 'Ещё одно' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().code, 'CHAT_CLOSED');
    const items = (await get(app, thread(r.chatId), bearer(s))).json().items;
    assert.deepEqual(items.map((m) => m.body), ['Подъезжаю'], 'the thread stays readable');
  }
});

test('chat: a cancel that commits while a send is in flight closes the chat (CodeRabbit #1151)', { skip: SKIP }, async (t) => {
  const { app, db, ride } = await fixture(t, [phone(4, 0), phone(4, 1)]);
  const r = await ride(phone(4, 0), phone(4, 1));
  assert.equal((await send(app, r.drvS, { chatId: r.chatId, body: 'прогрев' })).statusCode, 201); // warm the pool
  const holder = new pg.Client({ connectionString: DATABASE_URL });
  await holder.connect();
  t.after(() => holder.end());
  // A status transition that has not committed yet holds the ride row.
  await holder.query('BEGIN');
  await holder.query("UPDATE rides SET status = 'CANCELED', canceled_at = now() WHERE trip_id = $1", [r.tripId]);
  let settled = false;
  const pending = send(app, r.paxS, { chatId: r.chatId, body: 'в полёте' }).finally(() => { settled = true; });
  // Wait until the send is blocked on that row inside its transaction — or has already finished
  // (code without the ride lock never waits); either way the cancel then commits, so nothing hangs.
  let blocked = false;
  for (let i = 0; i < 100 && !settled; i += 1) {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE NOT l.granted AND l.locktype IN ('transactionid', 'tuple') AND a.pid <> $1`, [holder.processID],
    );
    if (rows[0].n > 0) { blocked = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await holder.query('COMMIT');
  const res = await pending;
  assert.ok(blocked, 'the send waited for the uncommitted cancel');
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().code, 'CHAT_CLOSED');
  const items = (await get(app, thread(r.chatId), bearer(r.paxS))).json().items;
  assert.deepEqual(items.map((m) => m.body), ['прогрев'], 'nothing was written to the closed chat');
});

test('chat: 30 messages a minute per sender in a thread; the other side and re-sends are not limited', { skip: SKIP }, async (t) => {
  const { app, db, ride } = await fixture(t, [phone(3, 0), phone(3, 1), phone(3, 2), phone(3, 3)]);
  const r = await ride(phone(3, 0), phone(3, 1));
  for (let i = 0; i < 30; i += 1) {
    assert.equal((await send(app, r.paxS, { chatId: r.chatId, body: `m${i}`, clientMsgId: i })).statusCode, 201, `message ${i}`);
  }
  const limited = await send(app, r.paxS, { chatId: r.chatId, body: 'one too many', clientMsgId: 99 });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().code, 'CHAT_RATE_LIMITED');
  assert.equal(limited.json().retryable, false);
  const wait = limited.json().retryAfterSeconds;
  assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 60, `wait ${wait}`);
  assert.equal(limited.headers['retry-after'], String(wait));
  // A re-send of a message already written is the original, not a new send.
  const resend = await send(app, r.paxS, { chatId: r.chatId, body: 'm0 again', clientMsgId: 0 });
  assert.equal(resend.statusCode, 201);
  assert.equal(resend.json().message.body, 'm0');
  // The driver has a limit of its own.
  assert.equal((await send(app, r.drvS, { chatId: r.chatId, body: 'ok' })).statusCode, 201);
  // Once the oldest message is older than a minute, the passenger may send again.
  await db.query(
    `UPDATE messages SET created_at = created_at - interval '61 seconds'
      WHERE chat_id = $1 AND sender_role = 'passenger' AND client_msg_id = 0`, [r.chatId],
  );
  assert.equal((await send(app, r.paxS, { chatId: r.chatId, body: 'later', clientMsgId: 100 })).statusCode, 201);

  // Concurrent sends cannot pass the same count: a burst of 40 on a fresh ride writes exactly 30.
  const r2 = await ride(phone(3, 2), phone(3, 3));
  const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => send(app, r2.drvS, { chatId: r2.chatId, body: `b${i}` })));
  assert.equal(burst.filter((res) => res.statusCode === 201).length, 30);
  assert.equal(burst.filter((res) => res.statusCode === 429).length, 10);
  const count = await db.query('SELECT count(*)::int AS n FROM messages WHERE chat_id = $1', [r2.chatId]);
  assert.equal(count.rows[0].n, 30);
});
