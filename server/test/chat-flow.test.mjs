// /server/test/chat-flow.test.mjs — DB-gated end-to-end for #784 R07 chat through the real Fastify
// app + real Postgres. Proves the minimal cross-device chat: messages POSTed to one chat_id form a
// single shared thread, clientMsgId makes re-sends idempotent, and the routes are AUTH-FREE (no
// token, per the epic). SKIPPED without DATABASE_URL; runs in server-ci. messages is a plain table
// (no append-only trigger), so cleanup is a plain DELETE by chat_id.
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

test('chat: one shared thread by chat_id, auth-free, clientMsgId-idempotent', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const chatId = `trip-chat-test-${process.pid}`;
  const cleanup = new pg.Client({ connectionString: DATABASE_URL });
  await cleanup.connect();
  t.after(async () => {
    await cleanup.query('DELETE FROM messages WHERE chat_id = $1', [chatId]).catch(() => {});
    await cleanup.end();
    await app.close();
  });

  // empty thread (no auth needed to read).
  assert.deepEqual((await get(app, `/api/v1/chat/messages?chatId=${encodeURIComponent(chatId)}`)).json().items, []);

  // "device A" (passenger) sends — NO Authorization header.
  const a = await post(app, '/api/v1/chat/messages', { chatId, body: 'Еду', senderRole: 'passenger', clientMsgId: 1001, displayTime: '14:21' });
  assert.equal(a.statusCode, 201, 'auth-free POST succeeds (not 401)');
  assert.equal(a.json().message.body, 'Еду');
  assert.equal(a.json().message.senderRole, 'passenger');
  assert.equal(a.json().message.clientMsgId, 1001);

  // re-send with the SAME clientMsgId (different body) is idempotent — returns the ORIGINAL.
  const aDup = await post(app, '/api/v1/chat/messages', { chatId, body: 'Еду (retry)', senderRole: 'passenger', clientMsgId: 1001 });
  assert.equal(aDup.statusCode, 201);
  assert.equal(aDup.json().message.id, a.json().message.id, 'dedup returns the same row');
  assert.equal(aDup.json().message.body, 'Еду', 'original body preserved (no overwrite)');

  // "device B" (driver) sends to the SAME chat_id — distinct discriminator, so a NEW message even
  // with the same clientMsgId. This is the cross-device proof: both in one Postgres thread.
  const b = await post(app, '/api/v1/chat/messages', { chatId, body: 'Подъезжаю', senderRole: 'driver', clientMsgId: 1001 });
  assert.equal(b.statusCode, 201);
  assert.notEqual(b.json().message.id, a.json().message.id, 'driver msg is distinct from passenger msg');

  // a message with NO clientMsgId always inserts (outside the dedup index).
  const c = await post(app, '/api/v1/chat/messages', { chatId, body: 'ok', senderRole: 'driver' });
  assert.equal(c.statusCode, 201);

  // device A reads the shared thread: 3 distinct messages, chronological.
  const thread = (await get(app, `/api/v1/chat/messages?chatId=${encodeURIComponent(chatId)}`)).json().items;
  assert.equal(thread.length, 3, 'one shared thread: passenger + driver + no-id, deduped re-send folded');
  assert.deepEqual(thread.map((m) => m.body), ['Еду', 'Подъезжаю', 'ok'], 'chronological order');

  // validation still applies: empty body / missing chatId -> 400.
  assert.equal((await post(app, '/api/v1/chat/messages', { chatId, body: '' })).statusCode, 400, 'empty body rejected');
  assert.equal((await post(app, '/api/v1/chat/messages', { body: 'x' })).statusCode, 400, 'chatId required');
});
