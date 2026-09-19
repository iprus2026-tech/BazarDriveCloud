import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTelegramId, createPrivateActorVerifier, isPrivateActor } from '../src/services/telegram-link-authority/actor.js';
import { createTelegramLinkAuthority } from '../src/services/telegram-link-authority/index.js';

const scope = { botId: '987654321', environment: 'test' };
const secret = 'synthetic_test_webhook_secret_0123456789';
const verify = createPrivateActorVerifier({ ...scope, webhookSecret: secret });
const message = () => ({ update_id: 42, message: {
  from: { id: 123456, is_bot: false }, chat: { id: 123456, type: 'private' }, text: '/start',
} });

test('private transport proof is bound to bot/environment and cannot be serialized', () => {
  const actor = verify(secret, message());
  assert.equal(isPrivateActor(actor, scope), true);
  assert.equal(isPrivateActor({ ...actor }, scope), false);
  assert.equal(isPrivateActor(actor, { ...scope, environment: 'production' }), false);
  assert.equal(isPrivateActor(actor, { ...scope, botId: '123' }), false);
  assert.equal(Object.isFrozen(actor), true);
});

test('wrong, absent and oversized secret headers cannot issue proof', () => {
  for (const value of [undefined, '', 42, 'x'.repeat(secret.length), 'x'.repeat(257)]) {
    assert.equal(verify(value, message()), null);
  }
});

test('group, mismatched chat and bot actors cannot enter personal scope', () => {
  for (const transform of [
    x => { x.message.chat.type = 'group'; },
    x => { x.message.chat.id = 999; },
    x => { x.message.from.is_bot = true; },
    x => { delete x.message.from; },
  ]) { const x = message(); transform(x); assert.equal(verify(secret, x), null); }
});

test('username, phone and forward origin do not select actor identity', () => {
  const x = message();
  x.message.from.username = 'different_person';
  x.message.contact = { phone_number: '+19990000000', user_id: 777 };
  x.message.forward_origin = { sender_user: { id: 777 } };
  assert.equal(verify(secret, x).telegramUserId, '123456');
});

test('callback actor is clicker, never the bot that authored the message', () => {
  const x = { update_id: 100, callback_query: { from: { id: 321, is_bot: false },
    message: { from: { id: 987654321, is_bot: true }, chat: { id: 321, type: 'private' } },
    data: '{"userId":"forged"}',
  } };
  assert.equal(verify(secret, x).telegramUserId, '321');
  x.callback_query.message.business_connection_id = 'business_context';
  assert.equal(verify(secret, x), null);
  delete x.callback_query.message.business_connection_id;
  x.callback_query.inline_message_id = 'inline_context';
  assert.equal(verify(secret, x), null);
  delete x.callback_query.inline_message_id;
  delete x.callback_query.message;
  assert.equal(verify(secret, x), null);
});

test('ambiguous, edited, business and malformed updates are ignored', () => {
  for (const x of [null, {}, { ...message(), edited_message: {} },
    { update_id: 1, business_message: message().message },
    { ...message(), update_id: -1 }, { ...message(), update_id: 1.5 }]) {
    assert.equal(verify(secret, x), null);
  }
});

test('Telegram ID parsing preserves large integer identities and rejects lossy forms', () => {
  assert.equal(canonicalTelegramId('4503599627370495'), '4503599627370495');
  for (const value of [0, -5, 1.1, 9007199254740993, '01', '1e5', '1.0', '+1', ' 1', '4503599627370496', {}]) {
    assert.equal(canonicalTelegramId(value), null);
  }
});

test('weak or missing transport configuration fails at construction', () => {
  for (const options of [{}, { ...scope }, { ...scope, webhookSecret: 'short' },
    { ...scope, environment: '../production', webhookSecret: secret }]) {
    assert.throws(() => createPrivateActorVerifier(options), TypeError);
  }
});

test('plain verified=true objects and other namespaces cannot touch the database', async () => {
  const db = { tx: () => assert.fail('untrusted actor reached database') };
  const api = createTelegramLinkAuthority(db, scope);
  const other = createPrivateActorVerifier({ ...scope, environment: 'other', webhookSecret: secret })(secret, message());
  for (const actor of [{ ...scope, verified: true, telegramUserId: '123456' }, other]) {
    for (const name of ['claimRequest','readOwnProfile','revokeFromTelegram']) {
      assert.deepEqual(await api[name]({ actor }), { ok: false, code: 'CHANNEL_PROOF_REQUIRED' });
    }
  }
});

test('only narrow profile read is exported; writes and arbitrary scope are absent', async () => {
  const api = createTelegramLinkAuthority({ tx: () => assert.fail('bad scope reached database') }, scope);
  const actor = verify(secret, message());
  const result = await api.readOwnProfile({ actor, linkId: '00000000-0000-4000-8000-000000000001', epoch: '1', role: 'admin' });
  assert.equal(result.code, 'FORBIDDEN');
  assert.equal(api.createOrder, undefined);
  assert.equal(api.resolveUser, undefined);
  assert.equal(api.mintToken, undefined);
});

test('database outage propagates; it is not an anonymous or successful result', async () => {
  const outage = new Error('synthetic database outage');
  const api = createTelegramLinkAuthority({ tx: async () => { throw outage; } }, scope);
  await assert.rejects(api.createRequest({ bearer: 'synthetic_bearer_12345678' }), err => err === outage);
});

test('actor proof expires at 60 seconds and is checked after a lock wait', async t => {
  let time = Date.now();
  t.mock.method(Date, 'now', () => time);
  const actor = verify(secret, message());
  const api = createTelegramLinkAuthority({ tx: fn => fn({ query: async () => { time += 60_000; } }) }, scope);
  assert.deepEqual(await api.claimRequest({ actor, nonce: 'unused' }), { ok: false, code: 'CHANNEL_PROOF_REQUIRED' });
  assert.equal(isPrivateActor(actor, scope), false);
});
