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

async function user(db, roles = ['passenger', 'driver']) {
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
  assert.equal((await read(api,l,'passenger')).ok,true);
  await db.query('UPDATE users SET phone_verified=false WHERE id=$1',[u.userId]);
  assert.equal((await read(api,l,'passenger')).code,'FORBIDDEN');
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
