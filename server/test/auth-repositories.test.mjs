// /server/test/auth-repositories.test.mjs — DB-gated round-trip for the auth repositories
// (users / otps / sessions) against a REAL PostgreSQL with migrations applied. server-ci's
// `app` job sets DATABASE_URL and runs `npm run migrate` before `npm test`, so this runs in
// CI; it is SKIPPED when DATABASE_URL is unset (hermetic local default). Every write happens
// inside a single transaction that is ROLLED BACK, so the suite leaves zero residue and is
// safe to re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import { findUserByPhone, findUserAuthorityById, upsertUserByPhone, markPhoneVerified, resolveVerifiedLoginUser } from '../src/repositories/users.js';
import { insertOtp, findLatestLiveOtpByPhone, markOtpConsumed, incrementOtpAttempts } from '../src/repositories/otps.js';
import { insertSession, resolveLiveSessionByTokenHash, revokeSessionById } from '../src/repositories/sessions.js';
import { hashToken, hashOtpCode, generateToken, generateOtpCode } from '../src/services/auth/tokens.js';

const DATABASE_URL = process.env.DATABASE_URL || '';

test('findUserAuthorityById selects only current authority by id without writes or legacy fallback', async () => {
  const row = { id: 'account-1', roles: ['passenger', 'driver'], phone_verified: true };
  let calls = 0;
  const db = { query: async (sql, params) => {
    calls += 1;
    assert.equal(sql.replace(/\s+/g, ' ').trim(),
      'SELECT id, roles, phone_verified FROM users WHERE id = $1 LIMIT 1');
    assert.deepEqual(params, [row.id]);
    return { rows: [row] };
  } };
  assert.deepEqual(await findUserAuthorityById(db, row.id), row);
  assert.equal(calls, 1, 'one SELECT, no grant/account/session writes');
});

test('findUserAuthorityById returns empty grants and unverified state without repair', async () => {
  const row = { id: 'account-1', roles: [], phone_verified: false };
  assert.deepEqual(await findUserAuthorityById({ query: async () => ({ rows: [row] }) }, row.id), row);
});

test('findUserAuthorityById returns null for a missing account', async () => {
  assert.equal(await findUserAuthorityById({ query: async () => ({ rows: [] }) }, 'missing'), null);
});

test('findUserAuthorityById propagates lookup errors to the authority boundary', async () => {
  const error = new Error('database unavailable');
  await assert.rejects(() => findUserAuthorityById({ query: async () => { throw error; } }, 'account-1'),
    (caught) => caught === error);
});

test('revokeSessionById atomically preserves the first stamp and selects only the session id', async () => {
  const row = { id: 'session-1', user_id: 'account-1', active_role: 'passenger',
    phone_verified: true, issued_at: new Date('2026-01-01T00:00:00Z'),
    expires_at: null, revoked_at: new Date('2026-01-02T00:00:00Z') };
  let calls = 0;
  const db = { query: async (sql, params) => {
    calls += 1;
    assert.equal(sql.replace(/\s+/g, ' ').trim(),
      'UPDATE auth_session SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 '
      + 'RETURNING id, user_id, active_role, phone_verified, issued_at, expires_at, revoked_at');
    assert.deepEqual(params, [row.id]);
    return { rows: [row] };
  } };
  assert.equal(await revokeSessionById(db, row.id), row, 'the persisted row passes through');
  assert.equal(calls, 1, 'one atomic UPDATE, no live lookup or sibling/account writes');
});

test('revokeSessionById returns null for a missing session', async () => {
  assert.equal(await revokeSessionById({ query: async () => ({ rows: [] }) }, 'missing'), null);
});

test('revokeSessionById propagates write errors', async () => {
  const error = new Error('database unavailable');
  await assert.rejects(() => revokeSessionById({ query: async () => { throw error; } }, 'session-1'),
    (caught) => caught === error);
});

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
      assert.deepEqual(await findUserAuthorityById(db, u1.id),
        { id: u1.id, roles: [], phone_verified: false });
      assert.equal(await findUserAuthorityById(db, '00000000-0000-0000-0000-000000000000'), null);
      const u2 = await upsertUserByPhone(db, { phone });
      assert.equal(u2.id, u1.id, 'same phone => SAME account id (distinct identity per phone)');
      const found = await findUserByPhone(db, phone);
      assert.equal(found.id, u1.id);
      const existingVerified = await resolveVerifiedLoginUser(db, { phone });
      assert.deepEqual(existingVerified.roles, [], 'existing roleless identity gets no automatic grant');
      assert.equal(existingVerified.active_role, null);
      const newPhone = phone + '1';
      const passenger = await resolveVerifiedLoginUser(db, { phone: newPhone });
      assert.equal(passenger.phone_verified, true);
      assert.deepEqual(passenger.roles, ['passenger']);
      assert.equal(passenger.active_role, 'passenger');
      const again = await resolveVerifiedLoginUser(db, { phone: newPhone });
      assert.equal(again.id, passenger.id);
      assert.deepEqual(again.roles, ['passenger']);
      await db.query("UPDATE users SET roles = ARRAY['driver']::text[], active_role = 'driver' WHERE id = $1", [passenger.id]);
      const driver = await resolveVerifiedLoginUser(db, { phone: newPhone });
      assert.deepEqual(driver.roles, ['driver']);
      assert.equal(driver.active_role, 'driver');
      assert.deepEqual(await findUserAuthorityById(db, passenger.id),
        { id: passenger.id, roles: ['driver'], phone_verified: true }, 'reader observes changed current grants');

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
      assert.equal(resolved.expires_at, null, 'NULL expiry remains live');
      const storedHash = await db.query('SELECT token_hash FROM auth_session WHERE id = $1', [sess.id]);
      assert.equal(storedHash.rows[0].token_hash, hashToken(token), 'only the token hash is stored');
      assert.notEqual(storedHash.rows[0].token_hash, token);
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken('wrong-token')), null,
        'a non-matching token resolves to nothing');

      // Keep DB timestamp precision: pg Date parsing would truncate microseconds and
      // could turn the exact-equality case into a past-expiry case.
      const { rows: [sessionTimes] } = await db.query(
        `SELECT now()::text AS tx_now,
                (now() + interval '5 minutes')::text AS future,
                (now() - interval '1 minute')::text AS past`,
      );
      const mintSession = (sessionToken, expiresAt) => insertSession(db, {
        userId: u1.id, tokenHash: hashToken(sessionToken), activeRole: 'passenger',
        phoneVerified: true, expiresAt,
      });

      const futureToken = generateToken();
      const futureSession = await mintSession(futureToken, sessionTimes.future);
      const futureLive = await resolveLiveSessionByTokenHash(db, hashToken(futureToken));
      assert.equal(futureLive.id, futureSession.id, 'future expiry resolves');

      const pastToken = generateToken();
      const pastSession = await mintSession(pastToken, sessionTimes.past);
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken(pastToken)), null,
        'past expiry does not resolve');

      const boundaryToken = generateToken();
      const boundarySession = await mintSession(boundaryToken, sessionTimes.tx_now);
      const boundary = await db.query('SELECT expires_at = now() AS exact FROM auth_session WHERE id = $1',
        [boundarySession.id]);
      assert.equal(boundary.rows[0].exact, true, 'fixture equals exact PostgreSQL transaction time');
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken(boundaryToken)), null,
        'expiry equal to now() is excluded by the strict boundary');

      const revoked = await revokeSessionById(db, futureSession.id);
      assert.equal(revoked.id, futureSession.id);
      assert.ok(revoked.revoked_at, 'live session is stamped revoked');
      assert.deepEqual(revoked, { ...futureLive, revoked_at: revoked.revoked_at },
        'revocation preserves identity, role, verification, issue time and expiry');
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken(futureToken)), null,
        'revoked session no longer resolves');
      const retried = await revokeSessionById(db, futureSession.id);
      assert.deepEqual(retried, revoked, 'retry returns the same row and first revocation timestamp');
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken(futureToken)), null,
        'already-revoked session remains excluded');
      assert.equal(await revokeSessionById(db, '00000000-0000-0000-0000-000000000000'), null,
        'missing valid session UUID returns null');

      const expiredRevoked = await revokeSessionById(db, pastSession.id);
      assert.equal(expiredRevoked.id, pastSession.id);
      assert.ok(expiredRevoked.revoked_at, 'expired existing row can still be explicitly revoked');
      assert.deepEqual(expiredRevoked.expires_at, pastSession.expires_at, 'expiry is not rewritten');
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken(pastToken)), null);

      // Two calls at transaction-stable now() cannot alone detect a restamp.
      // An already-revoked fixture with an earlier stamp must preserve that value.
      const oldRevokedToken = generateToken();
      const oldRevokedSession = await mintSession(oldRevokedToken, null);
      const oldStamp = await db.query(
        'UPDATE auth_session SET revoked_at = $2 WHERE id = $1 RETURNING revoked_at',
        [oldRevokedSession.id, sessionTimes.past],
      );
      const alreadyRevoked = await revokeSessionById(db, oldRevokedSession.id);
      assert.deepEqual(alreadyRevoked.revoked_at, oldStamp.rows[0].revoked_at,
        'an earlier persisted revocation stamp is never reset to transaction now()');
      assert.equal(await resolveLiveSessionByTokenHash(db, hashToken(oldRevokedToken)), null);
      assert.deepEqual(await resolveLiveSessionByTokenHash(db, hashToken(token)), resolved,
        'revoking other sessions leaves the NULL-expiry sibling intact');
    } finally {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });
