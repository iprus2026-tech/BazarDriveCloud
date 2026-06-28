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

      // OTP lifecycle. NOTE: now() is frozen for the whole transaction, so created_at is
      // stamped explicitly to give each row a distinct, deterministic recency.
      const future = new Date(Date.now() + 300_000);
      const past = new Date(Date.now() - 60_000);
      const stampCreatedAt = (id, iso) =>
        client.query('UPDATE auth_otp SET created_at = $2 WHERE id = $1', [id, iso]);

      // A single fresh OTP: live lookup returns it (hash comparable), attempts bumps.
      const code = generateOtpCode();
      const otpA = await insertOtp(db, { phone, codeHash: hashOtpCode(code), expiresAt: future, requestedIp: '203.0.113.7' });
      await stampCreatedAt(otpA.id, new Date(Date.now() - 120_000).toISOString()); // oldest
      assert.equal(otpA.attempts, 0);
      const liveA = await findLatestLiveOtpByPhone(db, phone);
      assert.equal(liveA.id, otpA.id, 'live lookup returns the fresh otp');
      assert.equal(liveA.code_hash, hashOtpCode(code), 'code stored & compared as a hash');
      assert.equal(await incrementOtpAttempts(db, otpA.id), 1, 'attempts bumps to 1');

      // Superseded (Codex #787 P1): a NEWER request wins the live lookup, and consuming the
      // newest must NOT fall back to the older still-unexpired code.
      const otpB = await insertOtp(db, { phone, codeHash: hashOtpCode('newer'), expiresAt: future });
      await stampCreatedAt(otpB.id, new Date(Date.now() - 60_000).toISOString()); // newer than A
      assert.equal((await findLatestLiveOtpByPhone(db, phone)).id, otpB.id, 'newest request wins');
      assert.ok(await markOtpConsumed(db, otpB.id), 'consuming the newest succeeds');
      assert.equal(await markOtpConsumed(db, otpB.id), null, 'double-consume is a no-op');
      assert.equal(await findLatestLiveOtpByPhone(db, phone), null,
        'after the newest is consumed, the older superseded code is NOT reachable');

      // Expiry (Codex #787 P2): an expired newest is excluded from the live lookup AND cannot
      // be consumed even by id (atomic expiry recheck at consume time).
      const otpC = await insertOtp(db, { phone, codeHash: hashOtpCode('expired'), expiresAt: past });
      await stampCreatedAt(otpC.id, new Date().toISOString()); // newest
      assert.equal(await findLatestLiveOtpByPhone(db, phone), null, 'expired newest is not live');
      assert.equal(await markOtpConsumed(db, otpC.id), null, 'cannot consume an expired otp');

      // Supersede AT CONSUME (Codex #788): once a newer code exists for the phone, an older
      // still-live code can no longer be consumed by id — closing the read->consume race where a
      // resend lands mid-verify. The strictly-newest live code still consumes fine.
      const supOld = await insertOtp(db, { phone, codeHash: hashOtpCode('sup-old'), expiresAt: future });
      await stampCreatedAt(supOld.id, new Date(Date.now() - 30_000).toISOString());
      const supNew = await insertOtp(db, { phone, codeHash: hashOtpCode('sup-new'), expiresAt: future });
      await stampCreatedAt(supNew.id, new Date(Date.now() + 1_000).toISOString()); // strictly newest
      assert.equal(await markOtpConsumed(db, supOld.id), null,
        'an older still-live code cannot be consumed once a newer one exists (supersede guard)');
      assert.ok(await markOtpConsumed(db, supNew.id), 'the latest live code consumes fine');

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
        otpId: otpB.id,
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
