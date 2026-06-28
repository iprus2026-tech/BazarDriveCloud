// /server/test/auth-repositories.test.mjs — DB-gated round-trip for the auth repositories
// (users / otps / sessions) against a REAL PostgreSQL with migrations applied. server-ci's
// `app` job sets DATABASE_URL and runs `npm run migrate` before `npm test`, so this runs in
// CI; it is SKIPPED when DATABASE_URL is unset (hermetic local default). Every write happens
// inside a single transaction that is ROLLED BACK, so the suite leaves zero residue and is
// safe to re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { findUserByPhone, upsertUserByPhone, markPhoneVerified } from '../src/repositories/users.js';
import { insertOtp, findLatestLiveOtpByPhone, markOtpConsumed, incrementOtpAttempts } from '../src/repositories/otps.js';
import { insertSession, resolveLiveSessionByTokenHash } from '../src/repositories/sessions.js';
import { hashToken, hashOtpCode, generateToken, generateOtpCode } from '../src/services/auth/tokens.js';

const DATABASE_URL = process.env.DATABASE_URL || '';

// Hermetic (no DB): upsertUserByPhone must reject a null/empty phone BEFORE any query, so a
// missing phone can't silently INSERT an anonymous row (one-identity-per-phone guard).
test('upsertUserByPhone rejects a null/empty phone before touching the DB', async () => {
  const db = { query: () => { throw new Error('must not query when phone is empty'); } };
  for (const bad of [undefined, null, '']) {
    await assert.rejects(() => upsertUserByPhone(db, { phone: bad }), /non-empty phone/);
  }
});

test('auth repositories round-trip against real Postgres (rolled back)',
  { skip: DATABASE_URL ? false : 'DATABASE_URL not set' },
  async () => {
    const { Client } = pg;
    const client = new Client({ connectionString: DATABASE_URL });
    await client.connect();
    const db = { query: (text, params) => client.query(text, params) };
    try {
      await client.query('BEGIN');
      const phone = `+1999${String(process.pid).padStart(6, '0')}`;

      // users: find-or-create is atomic & idempotent per phone (one account per number).
      assert.equal(await findUserByPhone(db, phone), null, 'no user before upsert');
      const u1 = await upsertUserByPhone(db, { phone });
      assert.ok(u1.id, 'upsert returns an id');
      assert.equal(u1.phone, phone);
      assert.equal(u1.phone_verified, false, 'new account is unverified');
      const u2 = await upsertUserByPhone(db, { phone });
      assert.equal(u2.id, u1.id, 'same phone => SAME account id (distinct identity per phone)');
      const found = await findUserByPhone(db, phone);
      assert.equal(found.id, u1.id);

      // otp: insert -> freshest-live lookup -> attempts bump -> consume removes it from live.
      const code = generateOtpCode(4);
      const otp = await insertOtp(db, {
        phone,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(Date.now() + 300_000),
        requestedIp: '203.0.113.7',
      });
      assert.ok(otp.id, 'otp inserted');
      assert.equal(otp.attempts, 0);
      const live = await findLatestLiveOtpByPhone(db, phone);
      assert.equal(live.id, otp.id, 'live lookup returns the fresh otp');
      assert.equal(live.code_hash, hashOtpCode(code), 'code stored as a hash, comparable');
      assert.equal(await incrementOtpAttempts(db, otp.id), 1, 'attempts bumps to 1');
      assert.ok(await markOtpConsumed(db, otp.id), 'first consume succeeds');
      assert.equal(await markOtpConsumed(db, otp.id), null, 'double-consume is a no-op');
      assert.equal(await findLatestLiveOtpByPhone(db, phone), null, 'consumed otp is no longer live');

      // expired otp is also excluded from the live lookup.
      await insertOtp(db, { phone, codeHash: hashOtpCode('0000'), expiresAt: new Date(Date.now() - 1_000) });
      assert.equal(await findLatestLiveOtpByPhone(db, phone), null, 'expired otp is not live');

      // user becomes server-verified.
      const verified = await markPhoneVerified(db, u1.id);
      assert.equal(verified.phone_verified, true);

      // session: mint -> resolve by token hash (only the hash is stored).
      const token = generateToken();
      const sess = await insertSession(db, {
        userId: u1.id,
        tokenHash: hashToken(token),
        activeRole: 'passenger',
        phoneVerified: true,
        otpId: otp.id,
        expiresAt: null,
      });
      assert.ok(sess.id, 'session minted');
      assert.equal(sess.user_id, u1.id);
      assert.equal(sess.active_role, 'passenger');
      const resolved = await resolveLiveSessionByTokenHash(db, hashToken(token));
      assert.equal(resolved.id, sess.id, 'live session resolves by token hash');
      assert.equal(resolved.phone_verified, true);
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken('wrong-token')), null,
        'a non-matching token resolves to nothing');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });
