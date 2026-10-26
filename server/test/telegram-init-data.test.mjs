// /server/test/telegram-init-data.test.mjs — BD-AUTH-TELEGRAM-01 M4 (#1127, ADR BD-DOCS-052):
// initData signature, auth_date window and `user`. Hermetic: a fake bot token, initData signed by
// the test itself. No network, no real bot.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyInitData, FUTURE_SKEW_SECONDS } from '../src/domain/telegram-init-data.js';
import { signedInitData, FAKE_BOT_TOKEN, OTHER_BOT_TOKEN } from './telegram-fixtures.mjs';

const NOW = 1_800_000_000;
const MAX_AGE = 600;

const userJson = (extra = {}) => JSON.stringify({ id: 777000111222, first_name: 'Иван', username: 'ivan', ...extra });
const base = (extra = {}) => ({ auth_date: String(NOW - 30), query_id: 'AAE1', user: userJson(), ...extra });
const verify = (initData, opts = {}) => verifyInitData(initData, {
  botToken: FAKE_BOT_TOKEN, nowSeconds: NOW, maxAgeSeconds: MAX_AGE, ...opts,
});

test('initData: a valid signature yields the Telegram id, the first name and the hash', () => {
  const result = verify(signedInitData(base()));
  assert.equal(result.ok, true);
  assert.equal(result.telegramUserId, 777000111222);
  assert.equal(result.firstName, 'Иван');
  assert.equal(result.authDate, NOW - 30);
  assert.match(result.hash, /^[0-9a-f]{64}$/);
});

test('initData: a `signature` field next to `hash` is part of the checked data', () => {
  const fields = base({ signature: 'Zm9vYmFy' });
  assert.equal(verify(signedInitData(fields)).ok, true);
  // Dropping it after signing breaks the HMAC.
  const tampered = new URLSearchParams(signedInitData(fields));
  tampered.delete('signature');
  assert.deepEqual(verify(tampered.toString()), { ok: false, code: 'TELEGRAM_INVALID' });
});

test('initData: tampering, a foreign bot, a duplicate key or garbage are TELEGRAM_INVALID', () => {
  const good = signedInitData(base());
  const tamperedField = new URLSearchParams(good);
  tamperedField.set('user', userJson({ id: 1 }));
  const tamperedHash = new URLSearchParams(good);
  tamperedHash.set('hash', '0'.repeat(64));
  const invalid = [
    tamperedField.toString(),
    tamperedHash.toString(),
    signedInitData(base(), OTHER_BOT_TOKEN),
    `${good}&auth_date=${NOW}`,
    good.replace(/hash=[0-9a-f]+/, 'hash=xyz'),
    new URLSearchParams(base()).toString(), // no hash at all
    'not initData',
    '',
  ];
  for (const initData of invalid) {
    assert.deepEqual(verify(initData), { ok: false, code: 'TELEGRAM_INVALID' }, initData.slice(0, 40));
  }
  assert.deepEqual(verify(good, { botToken: '' }), { ok: false, code: 'TELEGRAM_INVALID' });
  assert.deepEqual(verify(null), { ok: false, code: 'TELEGRAM_INVALID' });
});

test('initData: auth_date older than the max age is TELEGRAM_EXPIRED; future beyond the skew is invalid', () => {
  assert.equal(verify(signedInitData(base({ auth_date: String(NOW - MAX_AGE) }))).ok, true);
  assert.deepEqual(verify(signedInitData(base({ auth_date: String(NOW - MAX_AGE - 1) }))),
    { ok: false, code: 'TELEGRAM_EXPIRED', telegramUserId: 777000111222 });
  assert.equal(verify(signedInitData(base({ auth_date: String(NOW + FUTURE_SKEW_SECONDS) }))).ok, true);
  assert.deepEqual(verify(signedInitData(base({ auth_date: String(NOW + FUTURE_SKEW_SECONDS + 1) }))),
    { ok: false, code: 'TELEGRAM_INVALID' });
  for (const authDate of ['', 'abc', '0', '-5', '1.5']) {
    assert.deepEqual(verify(signedInitData(base({ auth_date: authDate }))), { ok: false, code: 'TELEGRAM_INVALID' }, authDate);
  }
});

test('initData: no `user`, or a user without a positive integer id, is TELEGRAM_NO_USER', () => {
  const { user, ...noUser } = base();
  for (const fields of [
    noUser,
    base({ user: '{not json' }),
    base({ user: JSON.stringify({ first_name: 'Иван' }) }),
    base({ user: JSON.stringify({ id: '777' }) }),
    base({ user: JSON.stringify({ id: -3 }) }),
    base({ user: JSON.stringify({ id: 1.5 }) }),
  ]) {
    assert.deepEqual(verify(signedInitData(fields)), { ok: false, code: 'TELEGRAM_NO_USER' }, fields.user);
  }
});

test('initData: the first name is trimmed and bounded; a missing one is empty', () => {
  assert.equal(verify(signedInitData(base({ user: userJson({ first_name: '  Анна  ' }) }))).firstName, 'Анна');
  assert.equal(verify(signedInitData(base({ user: userJson({ first_name: 'я'.repeat(200) }) }))).firstName.length, 64);
  assert.equal(verify(signedInitData(base({ user: JSON.stringify({ id: 5 }) }))).firstName, '');
});

test('initData: no result ever carries the raw initData or the token', () => {
  const initData = signedInitData(base());
  for (const result of [verify(initData), verify(`${initData}x`), verify(signedInitData(base({ auth_date: '1' })))]) {
    const text = JSON.stringify(result);
    assert.equal(text.includes(FAKE_BOT_TOKEN), false);
    assert.equal(text.includes('query_id'), false);
    assert.equal(text.includes(encodeURIComponent(userJson())), false);
  }
});
