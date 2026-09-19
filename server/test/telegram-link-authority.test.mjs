// Real PostgreSQL tests. Isolated per-test schemas permit genuine pool transactions
// and cleanup without deleting other tests' users or disabling audit protections.
// The tiny upstream fixtures have the real identity/session columns this slice reads;
// the new migration itself is applied verbatim (and replayed). Full existing server
// tests + public readiness cover the integrated migration chain in server-ci.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createTelegramLinkAuthority } from '../src/services/telegram-link-authority/index.js';
import { createPrivateActorVerifier } from '../src/services/telegram-link-authority/actor.js';
import { hashToken } from '../src/services/auth/tokens.js';
import { telegramLinkSchemaReady } from '../src/repositories/telegram_links.js';

const url = process.env.DATABASE_URL;
const skip = url ? false : 'DATABASE_URL not set — PostgreSQL gate not executed';
const migration = await readFile(new URL('../migrations/0010_telegram_link_authority.sql', import.meta.url), 'utf8');
const scope = { botId: '987654321', environment: 'test' };
const secret = 'synthetic_test_webhook_secret_0123456789';
const verifier = createPrivateActorVerifier({ ...scope, webhookSecret: secret });
function actor(id = 123456) {
  return verifier(secret, { update_id: 42, message: { from: { id, is_bot: false }, chat: { id, type: 'private' } } });
}

async function setup(t) {
  const admin = new pg.Client({ connectionString: url }); await admin.connect();
  const schema = 'tg_test_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema},public`, max: 5 });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await pool.query(`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), active_role text,
    roles text[] NOT NULL DEFAULT '{}', phone_verified boolean NOT NULL DEFAULT false);
    CREATE TABLE auth_session (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id),
    token_hash text NOT NULL UNIQUE, active_role text, phone_verified boolean NOT NULL DEFAULT false,
    issued_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz, revoked_at timestamptz)`);
  await pool.query(migration); await pool.query(migration);
  const db = { query: (...args) => pool.query(...args), async tx(fn) {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
    catch (err) { await c.query('ROLLBACK'); throw err; } finally { c.release(); }
  } };
  return { db, pool, schema, api: createTelegramLinkAuthority(db, scope) };
}

async function user(db, roles = ['driver', 'passenger']) {
  const { rows: [u] } = await db.query(`INSERT INTO users (roles,active_role,phone_verified) VALUES ($1,$2,true) RETURNING id`, [roles, roles[0] ?? null]);
  const bearer = 'synthetic_' + randomUUID();
  const { rows: [s] } = await db.query(`INSERT INTO auth_session (user_id,token_hash,active_role,phone_verified)
    VALUES ($1,$2,$3,true) RETURNING id`, [u.id, hashToken(bearer), roles[0] ?? null]);
  return { userId: u.id, sessionId: s.id, bearer };
}
async function claimed(api, u, who = actor()) {
  const r = await api.createRequest(u); assert.equal(r.ok, true);
  const claim = await api.claimRequest({ actor: who, nonce: r.startParameter.slice(5) }); assert.equal(claim.ok, true);
  return { ...r, ...claim, bearer: u.bearer };
}
async function linked(api, u, who = actor()) {
  const r = await claimed(api, u, who);
  const l = await api.confirmRequest(r); assert.equal(l.ok, true);
  return { ...l, request: r, actor: who };
}
const read = (api, l, role = 'driver') => api.readOwnProfile({ ...l, role });

test('0010: confirmed link, repeat confirm and no raw bearer/nonce in storage', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const l = await linked(api, u);
  assert.deepEqual(await api.confirmRequest(l.request), { ok: true, linkId: l.linkId, epoch: l.epoch, status: l.status, expiresAt: l.expiresAt });
  assert.equal((await read(api, l)).profile.userId, u.userId);
  const dump = JSON.stringify((await db.query('SELECT row_to_json(r) FROM telegram_link_requests r')).rows);
  assert.equal(dump.includes(l.request.startParameter.slice(5)), false);
  assert.equal(dump.includes(u.bearer), false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_account_links')).rows[0].n, 1);
});

test('claim is not login; foreign session cannot read or confirm candidate', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const other = await user(db);
  const r = await claimed(api, u);
  assert.equal((await api.confirmRequest({ ...r, bearer: other.bearer })).code, 'LINK_REQUEST_INVALID');
  assert.equal((await api.getRequest({ ...r, bearer: other.bearer })).code, 'LINK_REQUEST_INVALID');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_account_links')).rows[0].n, 0);
});

test('two independent claim transactions freeze one candidate', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const r = await api.createRequest(u);
  const replies = await Promise.all([actor(111), actor(222)].map(a => api.claimRequest({ actor: a, nonce: r.startParameter.slice(5) })));
  assert.equal(replies.filter(x => x.ok).length, 1);
  const winner = replies.find(x => x.ok);
  const again = await api.claimRequest({ actor: actor(Number(winner.candidateTelegramId)), nonce: r.startParameter.slice(5) });
  assert.deepEqual(again, winner);
});

test('concurrent confirmation is idempotent and transactional with audit', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const r = await claimed(api, u);
  const [a,b] = await Promise.all([api.confirmRequest(r), api.confirmRequest(r)]);
  assert.deepEqual(a,b);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM telegram_link_audit WHERE action='CONFIRMED'")).rows[0].n, 1);
});

test('one Telegram cannot win two account confirmations', { skip }, async t => {
  const { api, db } = await setup(t);
  const a = await claimed(api, await user(db)); const b = await claimed(api, await user(db));
  const replies = await Promise.all([api.confirmRequest(a), api.confirmRequest(b)]);
  assert.equal(replies.filter(x => x.ok).length, 1);
  assert.equal(replies.find(x => !x.ok).code, 'LINK_CONFLICT');
});

test('current role removal and phone revocation defeat session snapshots', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const l = await linked(api,u);
  await db.query("UPDATE users SET roles=ARRAY['passenger'] WHERE id=$1", [u.userId]);
  assert.equal((await read(api,l)).code,'FORBIDDEN');
  assert.equal((await read(api,l,'passenger')).code,'FORBIDDEN');
  await db.query("UPDATE users SET roles=ARRAY['driver','passenger'] WHERE id=$1", [u.userId]);
  assert.equal((await read(api,l)).ok,true);
  await db.query('UPDATE users SET phone_verified=false WHERE id=$1',[u.userId]);
  assert.equal((await read(api,l)).code,'FORBIDDEN');
});

test('session logout blocks reads and confirm; actor may still unlink', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const l = await linked(api,u);
  await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1',[u.sessionId]);
  assert.equal((await read(api,l)).code,'AUTH_REQUIRED');
  assert.equal((await api.confirmRequest(l.request)).code,'AUTH_REQUIRED');
  assert.equal((await api.revokeFromTelegram(l)).status,'REVOKED');
});

test('wrong actor and epoch never read or revoke a live link', { skip }, async t => {
  const { api, db } = await setup(t); const l = await linked(api,await user(db));
  assert.equal((await read(api,{...l,actor:actor(999)})).ok,false);
  assert.equal((await api.revokeFromTelegram({...l,actor:actor(999)})).ok,false);
  assert.equal((await read(api,{...l,epoch:String(BigInt(l.epoch)+1n)})).ok,false);
  assert.equal((await api.revokeFromTelegram({...l,epoch:String(BigInt(l.epoch)+1n)})).code,'STALE_LINK');
  assert.equal((await read(api,l)).ok,true);
});

test('unlink is idempotent; relink changes identity/epoch and stale button cannot revoke new link', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const old = await linked(api,u);
  const first = await api.revokeFromTelegram(old); assert.deepEqual(await api.revokeFromTelegram(old),first);
  assert.equal((await read(api,old)).ok,false);
  const next = await linked(api,u);
  assert.notEqual(old.linkId,next.linkId); assert.notEqual(old.epoch,next.epoch);
  await api.revokeFromTelegram(old); assert.equal((await read(api,next)).ok,true);
});

test('new request cancels old pending token and creation is bounded across sessions', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const first = await api.createRequest(u);
  for (let i=0;i<4;i++) assert.equal((await api.createRequest(u)).ok,true);
  assert.equal((await api.createRequest(u)).code,'RATE_LIMITED');
  assert.equal((await api.claimRequest({actor:actor(),nonce:first.startParameter.slice(5)})).code,'LINK_REQUEST_INVALID');
});

test('bad comparison code consumes a durable attempt budget', { skip }, async t => {
  const { api, db } = await setup(t); const r = await claimed(api,await user(db));
  const wrong = r.comparisonCode === '000000' ? '111111' : '000000';
  for(let i=0;i<5;i++) assert.equal((await api.confirmRequest({...r,comparisonCode:wrong})).code,'CONFIRMATION_MISMATCH');
  assert.equal((await api.confirmRequest(r)).code,'LINK_REQUEST_INVALID');
});

test('invalid claims have a durable per-actor throttle', { skip }, async t => {
  const { api } = await setup(t);
  for(let i=0;i<20;i++) assert.equal((await api.claimRequest({actor:actor(),nonce:'invalid'})).code,'LINK_REQUEST_INVALID');
  assert.equal((await api.claimRequest({actor:actor(),nonce:'invalid'})).code,'RATE_LIMITED');
});

test('old or expired session cannot start link, independent of client flags', { skip }, async t => {
  const { api,db }=await setup(t); const u=await user(db);
  await db.query("UPDATE auth_session SET issued_at=clock_timestamp()-interval '16 minutes' WHERE id=$1",[u.sessionId]);
  assert.equal((await api.createRequest({...u,phoneVerified:true})).code,'AUTH_REQUIRED');
  await db.query("UPDATE auth_session SET issued_at=clock_timestamp(), expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[u.sessionId]);
  assert.equal((await api.createRequest(u)).code,'AUTH_REQUIRED');
});

test('expired request cannot be claimed or confirmed even with the correct proof', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db);
  for (const state of ['PENDING', 'CLAIMED']) {
    const nonce = state === 'PENDING' ? 'a'.repeat(43) : 'b'.repeat(43);
    const { rows: [r] } = await db.query(`WITH t AS MATERIALIZED (SELECT clock_timestamp() AS ts)
      INSERT INTO telegram_link_requests
        (bot_id,environment,account_id,session_id,token_hash,comparison_code,state,candidate_id,created_at,expires_at)
      SELECT $1,$2,$3,$4,$5,'123456',$6,$7,t.ts-interval '6 minutes',t.ts-interval '1 minute'
      FROM t RETURNING id`, [scope.botId,scope.environment,u.userId,u.sessionId,hashToken(nonce),state,
      state === 'CLAIMED' ? '123456' : null]);
    const result = state === 'PENDING'
      ? await api.claimRequest({ actor: actor(), nonce })
      : await api.confirmRequest({ bearer: u.bearer, requestId: r.id, candidateTelegramId: '123456', comparisonCode: '123456' });
    assert.equal(result.code, 'LINK_REQUEST_EXPIRED');
    assert.equal((await api.getRequest({ bearer: u.bearer, requestId: r.id })).state, 'EXPIRED');
  }
  assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_account_links')).rows[0].n, 0);
});

test('grant expiry is bounded by originating session expiry', { skip }, async t => {
  const { api,db }=await setup(t); const u=await user(db);
  await db.query("UPDATE auth_session SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1",[u.sessionId]);
  const l=await linked(api,u);
  const {rows:[s]}=await db.query('SELECT expires_at FROM auth_session WHERE id=$1',[u.sessionId]);
  assert.equal(+l.expiresAt,+s.expires_at);
  await db.query("UPDATE auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[u.sessionId]);
  assert.equal((await read(api,l)).code,'AUTH_REQUIRED');
});

test('authority tuple and audit cannot be silently rewritten', { skip }, async t => {
  const { api,db }=await setup(t); const u=await user(db); const l=await linked(api,u);
  for(const [sql,params] of [
    ['UPDATE telegram_account_links SET account_id=$2 WHERE id=$1',[l.linkId,(await user(db)).userId]],
    ["UPDATE telegram_link_requests SET state='PENDING', candidate_id=NULL,confirmed_at=NULL WHERE id=$1",[l.request.requestId]],
    ["DELETE FROM telegram_link_audit WHERE action='CONFIRMED'",[]],
  ]) await assert.rejects(db.query(sql,params), err=>err.code==='23514');
});

test('audit failure rolls back confirmation and grants together', { skip }, async t => {
  const { api,db,pool }=await setup(t); const r=await claimed(api,await user(db));
  await pool.query(`CREATE FUNCTION reject_confirmation_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='CONFIRMED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_confirmation_audit BEFORE INSERT ON telegram_link_audit
    FOR EACH ROW EXECUTE FUNCTION reject_confirmation_audit()`);
  await assert.rejects(api.confirmRequest(r),/synthetic audit failure/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_account_links')).rows[0].n,0);
  assert.equal((await api.getRequest(r)).state,'CLAIMED');
});

test('public integration schema is ready after the complete migration chain', { skip }, async t => {
  const c=new pg.Client({connectionString:url}); await c.connect(); t.after(()=>c.end());
  assert.equal(await telegramLinkSchemaReady(c),true);
});

// R1 regression tests mutate only their own setup() schema. Savepoints restore DDL
// after each negative case; no shared public tables or catalog rows are modified.
async function rejectsSchemaChange(db, schema, sql) {
  await db.tx(async c => {
    assert.equal(await telegramLinkSchemaReady(c, schema), true);
    await c.query('SAVEPOINT before_schema_change');
    await c.query(sql);
    assert.equal(await telegramLinkSchemaReady(c, schema), false, sql);
    await c.query('ROLLBACK TO SAVEPOINT before_schema_change');
    assert.equal(await telegramLinkSchemaReady(c, schema), true, 'ready after restoring schema');
  });
}

test('R1 readiness: complete replayed schema is ready and another namespace cannot substitute', { skip }, async t => {
  const { db, schema } = await setup(t);
  assert.equal(await telegramLinkSchemaReady(db, schema), true);
  assert.equal(await telegramLinkSchemaReady(db, schema + '_absent'), false);
  await rejectsSchemaChange(db, schema, 'DROP TABLE telegram_link_audit');
});

test('R1 readiness: missing epoch default blocks readiness and confirmation; restoration recovers', { skip }, async t => {
  const { db, schema, api } = await setup(t);
  const r = await claimed(api, await user(db));
  assert.equal(await telegramLinkSchemaReady(db, schema), true);
  await db.query('ALTER TABLE telegram_account_links ALTER COLUMN epoch DROP DEFAULT');
  assert.equal(await telegramLinkSchemaReady(db, schema), false);
  await assert.rejects(api.confirmRequest(r), err => err.code === '23502');
  assert.equal((await api.getRequest(r)).state, 'CLAIMED');
  await db.query("ALTER TABLE telegram_account_links ALTER COLUMN epoch SET DEFAULT nextval('telegram_link_epoch_seq')");
  assert.equal(await telegramLinkSchemaReady(db, schema), true);
  assert.equal((await api.confirmRequest(r)).ok, true);
});

test('R1 readiness: epoch must use the exact sequence and plain nextval expression', { skip }, async t => {
  const { db, schema } = await setup(t);
  await db.query('CREATE SEQUENCE other_telegram_epoch_seq');
  for (const expr of ["1", "nextval('other_telegram_epoch_seq')", "nextval('telegram_link_epoch_seq') + 1"]) {
    await rejectsSchemaChange(db, schema, `ALTER TABLE telegram_account_links ALTER COLUMN epoch SET DEFAULT ${expr}`);
  }
  await rejectsSchemaChange(db, schema, 'ALTER SEQUENCE telegram_link_epoch_seq CYCLE');
  await rejectsSchemaChange(db, schema, 'ALTER SEQUENCE telegram_link_epoch_seq INCREMENT BY 2');
  await rejectsSchemaChange(db, schema, 'ALTER SEQUENCE telegram_link_epoch_seq CACHE 2');
});

test('R1 readiness: required ID, lifecycle and timestamp defaults cannot disappear', { skip }, async t => {
  const { db, schema } = await setup(t);
  for (const [table, column] of [
    ['telegram_link_requests','id'], ['telegram_link_requests','state'],
    ['telegram_link_requests','failed_confirms'], ['telegram_link_requests','created_at'],
    ['telegram_account_links','id'], ['telegram_account_links','status'],
    ['telegram_account_links','confirmed_at'], ['telegram_link_audit','created_at'],
  ]) await rejectsSchemaChange(db, schema, `ALTER TABLE ${table} ALTER COLUMN ${column} DROP DEFAULT`);
  await rejectsSchemaChange(db, schema, "ALTER TABLE telegram_link_requests ALTER COLUMN state SET DEFAULT 'CANCELED'");
});

test('R1 readiness: audit ID must retain GENERATED ALWAYS identity', { skip }, async t => {
  const { db, schema } = await setup(t);
  await rejectsSchemaChange(db, schema, 'ALTER TABLE telegram_link_audit ALTER COLUMN id DROP IDENTITY');
  await rejectsSchemaChange(db, schema, 'ALTER TABLE telegram_link_audit ALTER COLUMN id SET GENERATED BY DEFAULT');
});

test('R1 readiness: missing token/request uniqueness and wrong-key replacements are rejected', { skip }, async t => {
  const { db, schema } = await setup(t);
  for (const [table, name, wrongColumn] of [
    ['telegram_link_requests','telegram_link_requests_token_hash_key','comparison_code'],
    ['telegram_account_links','telegram_account_links_request_id_key','epoch'],
  ]) {
    await rejectsSchemaChange(db, schema, `ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
    await rejectsSchemaChange(db, schema, `ALTER TABLE ${table} DROP CONSTRAINT ${name};
      ALTER TABLE ${table} ADD CONSTRAINT ${name} UNIQUE (${wrongColumn})`);
  }
  await rejectsSchemaChange(db, schema, 'ALTER TABLE telegram_link_audit DROP CONSTRAINT telegram_link_audit_pkey');
});

test('R1 readiness: deferrable uniqueness cannot stand in for immediate enforcement', { skip }, async t => {
  const { db, schema } = await setup(t);
  await rejectsSchemaChange(db, schema, `ALTER TABLE telegram_link_requests DROP CONSTRAINT telegram_link_requests_token_hash_key;
    ALTER TABLE telegram_link_requests ADD CONSTRAINT telegram_link_requests_token_hash_key UNIQUE (token_hash) DEFERRABLE`);
});

test('R1 readiness: all Telegram foreign keys are required', { skip }, async t => {
  const { db, schema } = await setup(t);
  for (const [table, name] of [
    ['telegram_link_requests','telegram_link_requests_account_id_fkey'],
    ['telegram_link_requests','telegram_requests_session_account_fk'],
    ['telegram_account_links','telegram_account_links_request_id_fkey'],
    ['telegram_account_links','telegram_account_links_account_id_fkey'],
    ['telegram_account_links','telegram_links_session_account_fk'],
    ['telegram_link_audit','telegram_link_audit_request_id_fkey'],
    ['telegram_link_audit','telegram_link_audit_link_id_fkey'],
    ['telegram_link_audit','telegram_link_audit_authorizing_session_id_fkey'],
  ]) await rejectsSchemaChange(db, schema, `ALTER TABLE ${table} DROP CONSTRAINT ${name}`);
});

test('R1 readiness: same-name FK must retain source columns, target table and target columns', { skip }, async t => {
  const { db, schema } = await setup(t);
  await db.query('CREATE TABLE other_sessions (id uuid, user_id uuid, UNIQUE(id,user_id))');
  for (const definition of [
    'FOREIGN KEY(session_id,account_id) REFERENCES other_sessions(id,user_id)',
    'FOREIGN KEY(account_id,session_id) REFERENCES auth_session(id,user_id)',
    'FOREIGN KEY(session_id,account_id) REFERENCES auth_session(user_id,id)',
  ]) await rejectsSchemaChange(db, schema, `ALTER TABLE telegram_link_requests DROP CONSTRAINT telegram_requests_session_account_fk;
    ALTER TABLE telegram_link_requests ADD CONSTRAINT telegram_requests_session_account_fk ${definition} ON DELETE RESTRICT`);
});

test('R1 readiness: FK validation, delete action and deferral are checked', { skip }, async t => {
  const { db, schema } = await setup(t);
  for (const suffix of ['ON DELETE RESTRICT NOT VALID', 'ON DELETE CASCADE', 'ON DELETE RESTRICT DEFERRABLE']) {
    await rejectsSchemaChange(db, schema, `ALTER TABLE telegram_link_requests DROP CONSTRAINT telegram_requests_session_account_fk;
      ALTER TABLE telegram_link_requests ADD CONSTRAINT telegram_requests_session_account_fk
      FOREIGN KEY(session_id,account_id) REFERENCES auth_session(id,user_id) ${suffix}`);
  }
});

test('R2 role: delegated reads retain the session role for dual-role accounts', { skip }, async t => {
  const { api, db } = await setup(t);
  for (const [active, other, telegramId] of [['passenger','driver',111], ['driver','passenger',222]]) {
    const u = await user(db, [active, other]);
    const l = await linked(api, u, actor(telegramId));
    assert.equal((await read(api, l, active)).profile.activeRole, active);
    assert.deepEqual(await read(api, l, other), { ok: false, code: 'FORBIDDEN' });
    await db.query('UPDATE users SET active_role=$2 WHERE id=$1', [u.userId, other]);
    assert.equal((await read(api, l, active)).ok, true, 'another UI session cannot switch this session role');
    await db.query('UPDATE users SET roles=ARRAY[$2::text] WHERE id=$1', [u.userId, other]);
    assert.equal((await read(api, l, active)).code, 'FORBIDDEN', 'current membership is still required');
    assert.equal((await read(api, l, other)).code, 'FORBIDDEN', 'no fallback to another granted role');
  }
});

test('R2 lockout: fifth rejection emits one terminal cancellation, including concurrent retries', { skip }, async t => {
  const { api, db } = await setup(t); const r = await claimed(api, await user(db));
  const wrong = { ...r, comparisonCode: r.comparisonCode === '000000' ? '111111' : '000000' };
  for (let i=0; i<4; i++) assert.equal((await api.confirmRequest(wrong)).code, 'CONFIRMATION_MISMATCH');
  const replies = await Promise.all([api.confirmRequest(wrong), api.confirmRequest(wrong)]);
  assert.deepEqual(replies.map(x => x.code).sort(), ['CONFIRMATION_MISMATCH','LINK_REQUEST_INVALID'].sort());
  assert.equal((await api.confirmRequest(r)).code, 'LINK_REQUEST_INVALID');
  const { rows: [request] } = await db.query('SELECT state,failed_confirms FROM telegram_link_requests WHERE id=$1', [r.requestId]);
  assert.deepEqual(request, { state: 'CANCELED', failed_confirms: 5 });
  const { rows } = await db.query(`SELECT action,authorizing_session_id FROM telegram_link_audit
    WHERE request_id=$1 AND action IN ('CONFIRM_REJECTED','CANCELED') ORDER BY id`, [r.requestId]);
  assert.deepEqual(rows.map(x => x.action), [...Array(5).fill('CONFIRM_REJECTED'), 'CANCELED']);
  assert.ok(rows.every(x => x.authorizing_session_id === rows[0].authorizing_session_id));
  assert.ok(rows[0].authorizing_session_id);
});

test('R2 lockout: cancellation audit failure rolls back the fifth attempt and both audit events', { skip }, async t => {
  const { api, db } = await setup(t); const r = await claimed(api, await user(db));
  const wrong = { ...r, comparisonCode: r.comparisonCode === '000000' ? '111111' : '000000' };
  for (let i=0; i<4; i++) await api.confirmRequest(wrong);
  await db.query(`CREATE FUNCTION reject_cancel_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='CANCELED' THEN RAISE EXCEPTION 'synthetic cancellation audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_cancel_audit BEFORE INSERT ON telegram_link_audit
    FOR EACH ROW EXECUTE FUNCTION reject_cancel_audit()`);
  await assert.rejects(api.confirmRequest(wrong), /synthetic cancellation audit failure/);
  assert.deepEqual((await db.query('SELECT state,failed_confirms FROM telegram_link_requests WHERE id=$1', [r.requestId])).rows[0],
    { state: 'CLAIMED', failed_confirms: 4 });
  assert.equal((await db.query("SELECT count(*)::int AS n FROM telegram_link_audit WHERE action='CONFIRM_REJECTED'")).rows[0].n, 4);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM telegram_link_audit WHERE action='CANCELED'")).rows[0].n, 0);
  await db.query('DROP TRIGGER reject_cancel_audit ON telegram_link_audit');
  assert.equal((await api.confirmRequest(wrong)).code, 'CONFIRMATION_MISMATCH');
  assert.equal((await db.query("SELECT count(*)::int AS n FROM telegram_link_audit WHERE action='CANCELED'")).rows[0].n, 1);
});

for (const [table, index, third, predicate] of [
  ['telegram_link_requests','telegram_requests_account_time_idx','account_id',''],
  ['telegram_link_audit','telegram_audit_claim_rate_idx','actor_hash'," WHERE action='CLAIM_ATTEMPT'"],
]) test(`R2 readiness: ${index} must retain its complete rate-limit shape`, { skip }, async t => {
  const { db, schema } = await setup(t);
  const drop = `DROP INDEX ${index}; `;
  await rejectsSchemaChange(db, schema, drop);
  for (const definition of [
    `ON ${table}(environment,bot_id,${third},created_at DESC)${predicate}`,
    `ON ${table}(bot_id,environment,${third},created_at ASC)${predicate}`,
    `ON ${table}(bot_id,environment,${third},created_at DESC NULLS LAST)${predicate}`,
    `ON ${table}(bot_id,environment,${third}) INCLUDE (created_at)${predicate}`,
    `ON ${table}(lower(bot_id),environment,${third},created_at DESC)${predicate}`,
    `ON ${table}(bot_id text_pattern_ops,environment,${third},created_at DESC)${predicate}`,
    `ON ${table}(bot_id COLLATE "C",environment,${third},created_at DESC)${predicate}`,
    `ON ${table} USING brin(bot_id,environment,${third},created_at)${predicate}`,
    `ON ${table}(bot_id,environment,${third},created_at DESC)` + (predicate ? '' : " WHERE state='PENDING'"),
  ]) await rejectsSchemaChange(db, schema, drop + `CREATE INDEX ${index} ${definition}`);
  await rejectsSchemaChange(db, schema, drop + `CREATE UNIQUE INDEX ${index}
    ON ${table}(bot_id,environment,${third},created_at DESC)${predicate}`);
  await db.query(`CREATE TABLE rate_index_decoy (LIKE ${table})`);
  await rejectsSchemaChange(db, schema, drop + `CREATE INDEX ${index}
    ON rate_index_decoy(bot_id,environment,${third},created_at DESC)${predicate}`);
  if (predicate) await rejectsSchemaChange(db, schema, drop + `CREATE INDEX ${index}
    ON ${table}(bot_id,environment,${third},created_at DESC) WHERE action='CONFIRM_REJECTED'`);
});

// Observe a real PostgreSQL lock wait before advancing a clock or releasing a row.
// The bounded poll uses the monotonic clock, independent of the actor's mocked Date.
async function blockedOperation(pool, lockSql, params, operation, whileBlocked) {
  const blocker = await pool.connect();
  let pending, outcome, settled = false;
  try {
    await blocker.query('BEGIN');
    await blocker.query(lockSql, params);
    const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
    pending = Promise.resolve().then(operation).then(value => { settled = true; return { value }; },
      error => { settled = true; return { error }; });
    const deadline = performance.now() + 10_000;
    for (;;) {
      const { rows: [{ waiting }] } = await pool.query(`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))) AS waiting`, [pid]);
      if (waiting) break;
      assert.equal(settled, false, 'operation must actually wait on the held lock');
      assert.ok(performance.now() < deadline, 'timed out waiting for PostgreSQL lock contention');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    await whileBlocked(blocker);
  } finally {
    try { await blocker.query('ROLLBACK'); } finally { blocker.release(); }
    if (pending) outcome = await pending;
  }
  if (outcome.error) throw outcome.error;
  return outcome.value;
}

for (const target of ['claim-request','read-link','read-session','read-user','revoke-link']) {
  test(`R2 actor proof: expiry while waiting on ${target} refuses without protected effects`, { skip }, async t => {
    const { api, db, pool } = await setup(t); const u = await user(db);
    let clock = Date.now(); t.mock.method(Date, 'now', () => clock);
    const who = actor();
    const r = target === 'claim-request' ? await api.createRequest(u) : null;
    const l = r ? null : await linked(api, u, who);
    const table = r ? 'telegram_link_requests' : target === 'read-session' ? 'auth_session'
      : target === 'read-user' ? 'users' : 'telegram_account_links';
    const id = r ? r.requestId : target === 'read-session' ? u.sessionId
      : target === 'read-user' ? u.userId : l.linkId;
    const before = (await db.query('SELECT count(*)::int AS n FROM telegram_link_audit')).rows[0].n;
    const result = await blockedOperation(pool, `SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id],
      () => r ? api.claimRequest({ actor: who, nonce: r.startParameter.slice(5) })
        : target === 'revoke-link' ? api.revokeFromTelegram(l) : read(api, l),
      () => { clock += 60_000; });
    assert.deepEqual(result, { ok: false, code: 'CHANNEL_PROOF_REQUIRED' });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_link_audit')).rows[0].n, before);
    if (r) {
      const row = (await db.query('SELECT state,candidate_id FROM telegram_link_requests WHERE id=$1', [r.requestId])).rows[0];
      assert.deepEqual(row, { state: 'PENDING', candidate_id: null });
      assert.equal((await api.claimRequest({ actor: actor(), nonce: r.startParameter.slice(5) })).ok, true);
    } else {
      const row = (await db.query('SELECT status,epoch::text FROM telegram_account_links WHERE id=$1', [l.linkId])).rows[0];
      assert.deepEqual(row, { status: 'ACTIVE', epoch: l.epoch });
      assert.equal((await read(api, { ...l, actor: actor() })).ok, true);
    }
  });
}

test('R2 actor proof: expiry in a late audit wait rolls back an already-claimed request', { skip }, async t => {
  const { api, db, pool, schema } = await setup(t); const u = await user(db); const r = await api.createRequest(u);
  let clock = Date.now(); t.mock.method(Date, 'now', () => clock); const who = actor();
  const key = schema + '_late_audit';
  await db.query(`CREATE FUNCTION wait_claim_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.action='CLAIMED' THEN PERFORM pg_advisory_xact_lock(hashtextextended('${key}',0)); END IF; RETURN NEW; END $$;
    CREATE TRIGGER wait_claim_audit BEFORE INSERT ON telegram_link_audit
    FOR EACH ROW EXECUTE FUNCTION wait_claim_audit()`);
  const result = await blockedOperation(pool, 'SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key],
    () => api.claimRequest({ actor: who, nonce: r.startParameter.slice(5) }), () => { clock += 60_000; });
  assert.deepEqual(result, { ok: false, code: 'CHANNEL_PROOF_REQUIRED' });
  assert.deepEqual((await db.query('SELECT state,candidate_id FROM telegram_link_requests WHERE id=$1', [r.requestId])).rows[0],
    { state: 'PENDING', candidate_id: null });
  assert.deepEqual((await db.query('SELECT action FROM telegram_link_audit ORDER BY id')).rows.map(x => x.action), ['REQUESTED']);
});

async function finiteSession(db, u) {
  const { rows: [s] } = await db.query(`UPDATE auth_session SET expires_at=clock_timestamp()+interval '5 seconds'
    WHERE id=$1 RETURNING expires_at`, [u.sessionId]);
  return s.expires_at;
}
async function waitPastExpiry(client, expiresAt) {
  await client.query(`SELECT pg_sleep(GREATEST(0,EXTRACT(EPOCH FROM ($1::timestamptz-clock_timestamp())))+0.02)`, [expiresAt]);
}
async function assertConfirmationRolledBack(api, db, u, r) {
  assert.deepEqual((await db.query('SELECT state,confirmed_at FROM telegram_link_requests WHERE id=$1', [r.requestId])).rows[0],
    { state: 'CLAIMED', confirmed_at: null });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM telegram_account_links')).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM telegram_link_audit WHERE action='CONFIRMED'")).rows[0].n, 0);
  await db.query("UPDATE auth_session SET expires_at=clock_timestamp()+interval '1 hour' WHERE id=$1", [u.sessionId]);
  assert.equal((await api.confirmRequest(r)).ok, true, 'a later valid confirmation can still succeed');
}

test('R2 session: expiry during the request lock wait returns AUTH_REQUIRED without a constraint error', { skip }, async t => {
  const { api, db, pool } = await setup(t); const u = await user(db); const r = await claimed(api, u);
  const expiry = await finiteSession(db, u);
  const result = await blockedOperation(pool, 'SELECT id FROM telegram_link_requests WHERE id=$1 FOR UPDATE', [r.requestId],
    () => api.confirmRequest(r), client => waitPastExpiry(client, expiry));
  assert.deepEqual(result, { ok: false, code: 'AUTH_REQUIRED' });
  await assertConfirmationRolledBack(api, db, u, r);
});

test('R2 session: expiry immediately before link insertion rolls back confirmation', { skip }, async t => {
  const { api, db } = await setup(t); const u = await user(db); const r = await claimed(api, u);
  const expiry = await finiteSession(db, u);
  let delayed = false;
  const delayedDb = { ...db, tx: fn => db.tx(client => fn({ query: async (sql, params) => {
    if (sql.includes('INSERT INTO telegram_account_links')) {
      delayed = true;
      await waitPastExpiry(client, expiry);
    }
    return client.query(sql, params);
  } })) };
  const result = await createTelegramLinkAuthority(delayedDb, scope).confirmRequest(r);
  assert.equal(delayed, true, 'the test must reach the insertion after initial authorization');
  assert.deepEqual(result, { ok: false, code: 'AUTH_REQUIRED' });
  await assertConfirmationRolledBack(api, db, u, r);
});
