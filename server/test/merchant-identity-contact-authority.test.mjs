// /server/test/merchant-identity-contact-authority.test.mjs
// DB-gated PostgreSQL coverage for BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B (#977).
// SKIPPED without DATABASE_URL; server-ci supplies PostgreSQL 16.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

import { createMerchant, lockMerchantById, setMerchantStatus } from '../src/repositories/merchants.js';
import {
  createMerchantMembership,
  findActiveMerchantMembership,
  revokeMerchantMembership,
} from '../src/repositories/merchant_memberships.js';
import {
  createMerchantLocation,
  findDefaultMerchantLocation,
  lockMerchantLocationById,
  clearActiveDefaultMerchantLocation,
  setMerchantLocationDefault,
} from '../src/repositories/merchant_locations.js';
import {
  createExternalContactIdentity,
  findExternalContactIdentityByCanonical,
  linkExternalContactToUser,
  verifyExternalContactIdentity,
  revokeExternalContactIdentity,
} from '../src/repositories/external_contact_identities.js';
import {
  createMerchantContactBinding,
  revokeMerchantContactBinding,
} from '../src/repositories/merchant_contact_bindings.js';
import {
  resolveAuthorizedMerchantActor,
  resolveMerchantContext,
  resolveMerchantMembership,
} from '../src/services/merchant-identity-contact-authority/index.js';

const DATABASE_URL = process.env.DATABASE_URL || '';
const SKIP = DATABASE_URL ? false : 'DATABASE_URL not set';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function beginTxn(t) {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  await client.query('BEGIN');
  t.after(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });
  const db = { query: (text, params) => client.query(text, params) };
  db.tx = (fn) => fn(db);
  return db;
}

async function insertUser(db) {
  const { rows } = await db.query(`INSERT INTO users DEFAULT VALUES RETURNING id`);
  return rows[0].id;
}

async function createOperableMerchant(db, { displayName = 'Synthetic Merchant' } = {}) {
  const adminId = await insertUser(db);
  const merchant = await createMerchant(db, { displayName });
  assert.equal(merchant.status, 'SUSPENDED');
  await createMerchantMembership(db, {
    merchantId: merchant.id, userId: adminId, membershipRole: 'ADMIN',
  });
  const activated = await setMerchantStatus(db, merchant.id, 'ACTIVE');
  assert.equal(activated.status, 'ACTIVE');
  return { merchant: activated, adminId };
}

function assertPgCode(promise, code, name = null) {
  return assert.rejects(promise, (err) => {
    assert.equal(err.code, code, `expected PostgreSQL ${code}, got ${err.code}: ${err.message}`);
    if (name) assert.match(err.message, new RegExp(name));
    return true;
  });
}

let expectedErrorSavepointSeq = 0;
async function assertPgCodeInTxn(db, operation, code, name = null) {
  const savepoint = `expected_error_${++expectedErrorSavepointSeq}`;
  await db.query(`SAVEPOINT ${savepoint}`);
  try {
    await assertPgCode(operation(), code, name);
  } finally {
    // PostgreSQL marks a transaction aborted after a constraint error; rolling back to the
    // savepoint restores the ambient test transaction so the same scenario can keep proving
    // post-error invariants without committing residue.
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await db.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

async function newClient() {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  return client;
}

async function setupCommitted(t) {
  const db = await newClient();
  const userId = (await db.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;
  const merchantId = (await db.query(
    `INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`,
    [`Merchant ${randomUUID()}`],
  )).rows[0].id;

  t.after(async () => {
    await db.query(`DELETE FROM merchant_contact_bindings WHERE merchant_id = $1`, [merchantId]).catch(() => {});
    await db.query(`DELETE FROM merchant_locations WHERE merchant_id = $1`, [merchantId]).catch(() => {});
    await db.query(`DELETE FROM merchant_memberships WHERE merchant_id = $1`, [merchantId]).catch(() => {});
    await db.query(`DELETE FROM merchants WHERE id = $1`, [merchantId]).catch(() => {});
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
    await db.end();
  });
  return { db, userId, merchantId };
}

// ── structural schema ────────────────────────────────────────────────────────────────
test('0009: five merchant authority tables and load-bearing named objects exist', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { rows: tables } = await db.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        AND table_name = ANY($1::text[])
      ORDER BY table_name`,
    [[
      'external_contact_identities', 'merchant_contact_bindings', 'merchant_locations',
      'merchant_memberships', 'merchants',
    ]],
  );
  assert.deepEqual(tables.map((row) => row.table_name), [
    'external_contact_identities', 'merchant_contact_bindings', 'merchant_locations',
    'merchant_memberships', 'merchants',
  ]);

  const { rows: constraints } = await db.query(
    `SELECT pc.conname, pc.contype
       FROM pg_constraint pc
       JOIN pg_class c ON c.oid = pc.conrelid
      WHERE pc.conname = ANY($1::text[])
      ORDER BY pc.conname`,
    [[
      'external_contact_identities_canonical_uq',
      'external_contact_identities_lifecycle_check',
      'external_contact_identities_link_shape_check',
      'merchant_contact_bindings_lifecycle_check',
      'merchant_memberships_lifecycle_check',
      'merchants_status_check',
    ]],
  );
  assert.deepEqual(constraints.map((row) => row.conname), [
    'external_contact_identities_canonical_uq',
    'external_contact_identities_lifecycle_check',
    'external_contact_identities_link_shape_check',
    'merchant_contact_bindings_lifecycle_check',
    'merchant_memberships_lifecycle_check',
    'merchants_status_check',
  ]);

  const { rows: indexes } = await db.query(
    `SELECT relname FROM pg_class
      WHERE relkind = 'i' AND relname = ANY($1::text[])
      ORDER BY relname`,
    [[
      'merchant_contact_bindings_one_active_uq',
      'merchant_locations_one_active_default_uq',
      'merchant_memberships_one_active_per_user_uq',
    ]],
  );
  assert.deepEqual(indexes.map((row) => row.relname), [
    'merchant_contact_bindings_one_active_uq',
    'merchant_locations_one_active_default_uq',
    'merchant_memberships_one_active_per_user_uq',
  ]);

  const merchantStatus = (await db.query(
    `SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='merchants' AND column_name='status'`,
  )).rows[0];
  assert.match(merchantStatus.column_default, /SUSPENDED/);

  const { rows: triggerDefs } = await db.query(
    `SELECT t.tgname, pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t
       JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relname IN ('merchants','merchant_memberships')
        AND t.tgname IN ('trg_merchants_guard_lifecycle','trg_merchant_memberships_guard_immutability')
        AND NOT t.tgisinternal
      ORDER BY t.tgname`,
  );
  const triggerByName = new Map(triggerDefs.map((row) => [row.tgname, row.definition]));
  assert.match(triggerByName.get('trg_merchants_guard_lifecycle'), /BEFORE INSERT OR UPDATE/);
  assert.match(triggerByName.get('trg_merchant_memberships_guard_immutability'), /BEFORE DELETE OR UPDATE|BEFORE UPDATE OR DELETE/);
});

test('0009: authority unique-index shapes and historical FK delete actions are structural', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { rows: indexRows } = await db.query(
    `SELECT ci.relname, pg_get_indexdef(ci.oid) AS definition,
            pg_get_expr(pi.indpred, pi.indrelid) AS predicate
       FROM pg_class ci
       JOIN pg_index pi ON pi.indexrelid = ci.oid
      WHERE ci.relname = ANY($1::text[])
      ORDER BY ci.relname`,
    [[
      'merchant_contact_bindings_one_active_uq',
      'merchant_locations_one_active_default_uq',
      'merchant_memberships_one_active_per_user_uq',
    ]],
  );
  const byIndex = new Map(indexRows.map((row) => [row.relname, row]));
  assert.match(byIndex.get('merchant_memberships_one_active_per_user_uq').definition, /\(merchant_id, user_id\)/);
  assert.match(byIndex.get('merchant_memberships_one_active_per_user_uq').predicate, /status = 'ACTIVE'/);
  assert.match(byIndex.get('merchant_contact_bindings_one_active_uq').definition, /\(merchant_id, external_contact_identity_id\)/);
  assert.match(byIndex.get('merchant_contact_bindings_one_active_uq').predicate, /status = 'ACTIVE'/);
  assert.match(byIndex.get('merchant_locations_one_active_default_uq').definition, /\(merchant_id\)/);
  assert.match(byIndex.get('merchant_locations_one_active_default_uq').predicate, /status = 'ACTIVE'/);
  assert.match(byIndex.get('merchant_locations_one_active_default_uq').predicate, /is_default_pickup/);

  const expectedTargets = new Map([
    ['merchant_memberships_merchant_id_fkey', 'merchants'],
    ['merchant_memberships_user_id_fkey', 'users'],
    ['merchant_locations_merchant_id_fkey', 'merchants'],
    ['external_contact_identities_linked_user_id_fkey', 'users'],
    ['merchant_contact_bindings_merchant_id_fkey', 'merchants'],
    ['merchant_contact_bindings_external_contact_identity_id_fkey', 'external_contact_identities'],
  ]);
  const { rows: fkRows } = await db.query(
    `SELECT pc.conname, pc.confdeltype, target.relname AS target_table
       FROM pg_constraint pc
       JOIN pg_class target ON target.oid = pc.confrelid
      WHERE pc.conname = ANY($1::text[])
      ORDER BY pc.conname`,
    [[...expectedTargets.keys()]],
  );
  assert.equal(fkRows.length, expectedTargets.size);
  for (const row of fkRows) {
    assert.equal(row.confdeltype, 'r', `${row.conname} must be ON DELETE RESTRICT`);
    assert.equal(row.target_table, expectedTargets.get(row.conname));
  }
});

// ── lifecycle + repository primitives ───────────────────────────────────────────────
test('merchant bootstrap is fail-closed: raw rows start SUSPENDED and ACTIVE requires an ADMIN', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  await assertPgCodeInTxn(
    db,
    () => db.query(`INSERT INTO merchants (display_name, status) VALUES ('Synthetic Active', 'ACTIVE')`),
    '23514', 'bootstrap',
  );

  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  assert.equal(merchant.status, 'SUSPENDED');
  await assertPgCodeInTxn(db, () => setMerchantStatus(db, merchant.id, 'ACTIVE'), '23514', 'activation requires');

  const adminId = await insertUser(db);
  await createMerchantMembership(db, { merchantId: merchant.id, userId: adminId, membershipRole: 'ADMIN' });
  assert.equal((await setMerchantStatus(db, merchant.id, 'ACTIVE')).status, 'ACTIVE');
  assert.equal((await setMerchantStatus(db, merchant.id, 'SUSPENDED')).status, 'SUSPENDED');
  assert.equal((await setMerchantStatus(db, merchant.id, 'ACTIVE')).status, 'ACTIVE');
  assert.equal((await setMerchantStatus(db, merchant.id, 'CLOSED')).status, 'CLOSED');
  await assertPgCode(setMerchantStatus(db, merchant.id, 'ACTIVE'), '23514', 'terminal');
});

test('membership role is pinned for the lifetime of a row', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const userId = await insertUser(db);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  const membership = await createMerchantMembership(db, {
    merchantId: merchant.id, userId, membershipRole: 'ADMIN',
  });
  await assertPgCode(
    db.query(`UPDATE merchant_memberships SET membership_role='OPERATOR' WHERE id=$1`, [membership.id]),
    '23514', 'role',
  );
});

test('membership revoke is terminal and later re-grant uses a new row', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const userId = await insertUser(db);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  const first = await createMerchantMembership(db, { merchantId: merchant.id, userId, membershipRole: 'ADMIN' });
  const revoked = await revokeMerchantMembership(db, first.id);
  assert.equal(revoked.status, 'REVOKED');
  await assertPgCodeInTxn(
    db,
    () => db.query(`UPDATE merchant_memberships SET status='ACTIVE', revoked_at=NULL WHERE id=$1`, [first.id]),
    '23514',
    'terminal',
  );
  const second = await createMerchantMembership(db, { merchantId: merchant.id, userId, membershipRole: 'ADMIN' });
  assert.notEqual(second.id, first.id);
  assert.equal((await findActiveMerchantMembership(db, { merchantId: merchant.id, userId })).id, second.id);
});

test('external canonical tuple is unique and linked_user_id cannot be overwritten', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const userA = await insertUser(db);
  const userB = await insertUser(db);
  const key = `subject-${randomUUID()}`;
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
  });
  await assertPgCodeInTxn(
    db,
    () => createExternalContactIdentity(db, {
      channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
    }),
    '23505',
    'external_contact_identities_canonical_uq',
  );
  const linked = await linkExternalContactToUser(db, { identityId: identity.id, userId: userA });
  assert.equal(linked.linked_user_id, userA);
  await assertPgCode(
    db.query(`UPDATE external_contact_identities SET linked_user_id=$2, linked_at=now() WHERE id=$1`, [identity.id, userB]),
    '23514',
    'linked user requires explicit recovery to change',
  );
});

test('only one ACTIVE default pickup location exists per merchant', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  const first = await createMerchantLocation(db, {
    merchantId: merchant.id, label: 'A', addressText: 'Synthetic address A', isDefaultPickup: true,
  });
  assert.equal((await findDefaultMerchantLocation(db, merchant.id)).id, first.id);
  await assertPgCode(
    createMerchantLocation(db, {
      merchantId: merchant.id, label: 'B', addressText: 'Synthetic address B', isDefaultPickup: true,
    }),
    '23505',
    'merchant_locations_one_active_default_uq',
  );
});

test('pickup instructions are bounded at 512 characters', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  await createMerchantLocation(db, {
    merchantId: merchant.id, label: 'Bounded', addressText: 'Synthetic address',
    pickupInstructions: 'x'.repeat(512),
  });
  await assertPgCode(
    createMerchantLocation(db, {
      merchantId: merchant.id, label: 'Too long', addressText: 'Synthetic address',
      pickupInstructions: 'x'.repeat(513),
    }),
    '23514', 'merchant_locations_pickup_instructions_length_check',
  );
});

// ── dark service composition ─────────────────────────────────────────────────────────
test('context resolution is not authorization; VERIFIED + linked user + membership composes actor authority', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const userId = await insertUser(db);
  const { merchant } = await createOperableMerchant(db);
  const membership = await createMerchantMembership(db, {
    merchantId: merchant.id, userId, membershipRole: 'OPERATOR',
  });
  const identity = await createExternalContactIdentity(db, {
    channel: 'SMS', subjectNamespace: 'sms:e164', canonicalSubjectKey: '+15550001234',
    phoneE164: '+15550001234',
  });
  await createMerchantContactBinding(db, {
    merchantId: merchant.id,
    externalContactIdentityId: identity.id,
    relationship: 'OPERATOR',
    provenance: 'synthetic-test-bootstrap',
  });

  const context = await resolveMerchantContext(db, {
    channel: 'SMS', subjectNamespace: 'sms:e164', canonicalSubjectKey: '+15550001234',
  });
  assert.equal(context.ok, true);

  const beforeProof = await resolveAuthorizedMerchantActor(db, {
    channel: 'SMS', subjectNamespace: 'sms:e164', canonicalSubjectKey: '+15550001234',
  });
  assert.deepEqual(beforeProof, { ok: false, code: 'CONTACT_CHANNEL_PROOF_REQUIRED' });

  await verifyExternalContactIdentity(db, identity.id);
  const beforeLink = await resolveAuthorizedMerchantActor(db, {
    channel: 'SMS', subjectNamespace: 'sms:e164', canonicalSubjectKey: '+15550001234',
  });
  assert.deepEqual(beforeLink, { ok: false, code: 'CONTACT_USER_LINK_REQUIRED' });

  await linkExternalContactToUser(db, { identityId: identity.id, userId });

  const authorized = await resolveAuthorizedMerchantActor(db, {
    channel: 'SMS', subjectNamespace: 'sms:e164', canonicalSubjectKey: '+15550001234',
  });
  assert.equal(authorized.ok, true);
  assert.equal(authorized.code, 'AUTHORIZED_MERCHANT_ACTOR');
  assert.equal(authorized.userId, userId);
  assert.equal(authorized.merchant.id, merchant.id);
  assert.equal(authorized.membership.id, membership.id);

  const adminOnly = await resolveAuthorizedMerchantActor(db, {
    channel: 'SMS', subjectNamespace: 'sms:e164', canonicalSubjectKey: '+15550001234',
    allowedRoles: ['ADMIN'],
  });
  assert.deepEqual(adminOnly, { ok: false, code: 'MERCHANT_ACTOR_UNAUTHORIZED' });
});

test('actor resolution fails closed after the linked membership is revoked', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const operatorId = await insertUser(db);
  const { merchant } = await createOperableMerchant(db);
  const membership = await createMerchantMembership(db, {
    merchantId: merchant.id, userId: operatorId, membershipRole: 'OPERATOR',
  });
  const key = `subject-${randomUUID()}`;
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
  });
  await verifyExternalContactIdentity(db, identity.id);
  await linkExternalContactToUser(db, { identityId: identity.id, userId: operatorId });
  await createMerchantContactBinding(db, {
    merchantId: merchant.id, externalContactIdentityId: identity.id,
    relationship: 'OPERATOR', provenance: 'synthetic-effective-state',
  });

  assert.equal((await resolveAuthorizedMerchantActor(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
  })).ok, true);

  assert.equal((await revokeMerchantMembership(db, membership.id)).status, 'REVOKED');
  assert.deepEqual(
    await resolveAuthorizedMerchantActor(db, {
      channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
    }),
    { ok: false, code: 'MERCHANT_MEMBERSHIP_REQUIRED' },
  );
});


test('merchant membership resolution distinguishes missing merchant from inoperable merchant', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const userId = await insertUser(db);
  const { merchant } = await createOperableMerchant(db);
  await createMerchantMembership(db, { merchantId: merchant.id, userId, membershipRole: 'OPERATOR' });
  await setMerchantStatus(db, merchant.id, 'SUSPENDED');
  assert.deepEqual(
    await resolveMerchantMembership(db, { merchantId: merchant.id, userId }),
    { ok: false, code: 'MERCHANT_INOPERABLE' },
  );
  assert.deepEqual(
    await resolveMerchantMembership(db, { merchantId: randomUUID(), userId }),
    { ok: false, code: 'MERCHANT_NOT_FOUND' },
  );
});

test('external identity revocation is timestamped and terminal', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business',
    canonicalSubjectKey: `subject-${randomUUID()}`,
  });
  const revoked = await revokeExternalContactIdentity(db, identity.id);
  assert.equal(revoked.status, 'REVOKED');
  assert.ok(revoked.revoked_at);
  await assertPgCode(
    db.query(`UPDATE external_contact_identities SET status='ACTIVE', revoked_at=NULL WHERE id=$1`, [identity.id]),
    '23514', 'terminal',
  );
});

test('privacy: resolver projections/errors do not echo canonical keys, phone metadata, or binding evidence', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const keyCanary = `PII-KEY-${randomUUID()}`;
  const provenanceCanary = `PII-EVIDENCE-${randomUUID()}`;
  const phoneCanary = '+15550009999';

  const unknown = await resolveMerchantContext(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: keyCanary,
  });
  assert.deepEqual(unknown, { ok: false, code: 'EXTERNAL_CONTACT_UNKNOWN' });
  assert.equal(JSON.stringify(unknown).includes(keyCanary), false);

  const { merchant } = await createOperableMerchant(db);
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: keyCanary,
    phoneE164: phoneCanary, displayName: 'PII-DISPLAY-CANARY',
  });
  await createMerchantContactBinding(db, {
    merchantId: merchant.id, externalContactIdentityId: identity.id,
    relationship: 'CONTACT', provenance: provenanceCanary,
  });
  const resolved = await resolveMerchantContext(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: keyCanary,
  });
  assert.equal(resolved.ok, true);
  const wire = JSON.stringify(resolved);
  for (const forbidden of [keyCanary, phoneCanary, provenanceCanary, 'PII-DISPLAY-CANARY']) {
    assert.equal(wire.includes(forbidden), false, `resolver projection leaked ${forbidden}`);
  }
});

test('two operable merchant bindings are ambiguous unless explicit merchant context is supplied', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { merchant: merchantA } = await createOperableMerchant(db, { displayName: 'Merchant A' });
  const { merchant: merchantB } = await createOperableMerchant(db, { displayName: 'Merchant B' });
  const key = `subject-${randomUUID()}`;
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
  });
  for (const merchant of [merchantA, merchantB]) {
    await createMerchantContactBinding(db, {
      merchantId: merchant.id, externalContactIdentityId: identity.id,
      relationship: 'CONTACT', provenance: 'synthetic-test-bootstrap',
    });
  }

  assert.deepEqual(
    await resolveMerchantContext(db, {
      channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
    }),
    { ok: false, code: 'MERCHANT_CONTEXT_AMBIGUOUS' },
  );
  const exact = await resolveMerchantContext(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
    merchantId: merchantB.id,
  });
  assert.equal(exact.ok, true);
  assert.equal(exact.merchant.id, merchantB.id);
});


test('last ACTIVE ADMIN cannot be revoked while the merchant remains ACTIVE', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const { merchant, adminId } = await createOperableMerchant(db);
  const membership = await findActiveMerchantMembership(db, { merchantId: merchant.id, userId: adminId });
  await assertPgCodeInTxn(db, () => revokeMerchantMembership(db, membership.id), '23514', 'last ACTIVE ADMIN');
  await assertPgCodeInTxn(
    db, () => db.query(`DELETE FROM merchant_memberships WHERE id=$1`, [membership.id]),
    '23514', 'last ACTIVE ADMIN',
  );
  assert.ok(await findActiveMerchantMembership(db, { merchantId: merchant.id, userId: adminId }));

  // Explicit close is the frozen escape hatch: once merchant is no longer ACTIVE, the final
  // ADMIN may be revoked without leaving an operable merchant orphaned.
  await setMerchantStatus(db, merchant.id, 'CLOSED');
  assert.equal((await revokeMerchantMembership(db, membership.id)).status, 'REVOKED');
});

// ── genuine cross-transaction concurrency proofs ─────────────────────────────────────
async function proveSecondInsertWaitsThenUniqueFails(t, { firstSql, firstParams, secondSql, secondParams, constraint }) {
  const a = await newClient();
  const b = await newClient();
  t.after(async () => { await a.end().catch(() => {}); await b.end().catch(() => {}); });
  await a.query('BEGIN');
  await b.query('BEGIN');
  await a.query(firstSql, firstParams);

  let settled = false;
  // Capture the second INSERT's outcome into a promise that never rejects, with the
  // rejection handler attached at creation time. Otherwise the expected 23505 can land in
  // the window between `a` COMMIT and the assertion below and surface as an
  // unhandledRejection, which Node's test runner counts as a failure.
  const second = b.query(secondSql, secondParams).then(
    () => { settled = true; return { ok: true, error: null }; },
    (error) => { settled = true; return { ok: false, error }; },
  );
  await delay(75);
  assert.equal(settled, false, 'second transaction should wait on the uniqueness conflict');
  await a.query('COMMIT');

  const outcome = await second;
  assert.equal(outcome.ok, false, 'second insert must fail once the first transaction commits');
  assert.equal(
    outcome.error.code, '23505',
    `expected PostgreSQL 23505, got ${outcome.error?.code}: ${outcome.error?.message}`,
  );
  assert.match(outcome.error.message, new RegExp(constraint));
  await b.query('ROLLBACK');
}

test('concurrency: canonical external identity has exactly one winner', { skip: SKIP }, async (t) => {
  const key = `subject-${randomUUID()}`;
  const ns = `ns-${randomUUID()}`;
  const cleanup = await newClient();
  t.after(async () => {
    await cleanup.query(
      `DELETE FROM external_contact_identities WHERE channel='WHATSAPP' AND subject_namespace=$1 AND canonical_subject_key=$2`,
      [ns, key],
    ).catch(() => {});
    await cleanup.end();
  });
  const sql = `INSERT INTO external_contact_identities (channel, subject_namespace, canonical_subject_key)
               VALUES ('WHATSAPP', $1, $2)`;
  await proveSecondInsertWaitsThenUniqueFails(t, {
    firstSql: sql, firstParams: [ns, key], secondSql: sql, secondParams: [ns, key],
    constraint: 'external_contact_identities_canonical_uq',
  });
});

test('concurrency: one ACTIVE membership per merchant/user has exactly one winner', { skip: SKIP }, async (t) => {
  const { db, userId, merchantId } = await setupCommitted(t);
  const sql = `INSERT INTO merchant_memberships (merchant_id, user_id, membership_role)
               VALUES ($1, $2, 'OPERATOR')`;
  await proveSecondInsertWaitsThenUniqueFails(t, {
    firstSql: sql, firstParams: [merchantId, userId], secondSql: sql, secondParams: [merchantId, userId],
    constraint: 'merchant_memberships_one_active_per_user_uq',
  });
  assert.equal((await db.query(
    `SELECT count(*)::int AS n FROM merchant_memberships WHERE merchant_id=$1 AND user_id=$2 AND status='ACTIVE'`,
    [merchantId, userId],
  )).rows[0].n, 1);
});

test('concurrency: one ACTIVE contact binding per merchant/contact has exactly one winner', { skip: SKIP }, async (t) => {
  const { db, merchantId } = await setupCommitted(t);
  const ns = `ns-${randomUUID()}`;
  const key = `subject-${randomUUID()}`;
  const identityId = (await db.query(
    `INSERT INTO external_contact_identities (channel, subject_namespace, canonical_subject_key)
     VALUES ('WHATSAPP', $1, $2) RETURNING id`,
    [ns, key],
  )).rows[0].id;
  const sql = `INSERT INTO merchant_contact_bindings
                 (merchant_id, external_contact_identity_id, relationship, provenance)
               VALUES ($1, $2, 'CONTACT', 'synthetic-concurrency')`;
  await proveSecondInsertWaitsThenUniqueFails(t, {
    firstSql: sql, firstParams: [merchantId, identityId],
    secondSql: sql, secondParams: [merchantId, identityId],
    constraint: 'merchant_contact_bindings_one_active_uq',
  });
  // Clean the committed child rows before setupCommitted's merchant/user cleanup hook runs.
  await db.query(`DELETE FROM merchant_contact_bindings WHERE external_contact_identity_id=$1`, [identityId]);
  await db.query(`DELETE FROM external_contact_identities WHERE id=$1`, [identityId]);
});

test('concurrency: one ACTIVE default pickup location per merchant has exactly one winner', { skip: SKIP }, async (t) => {
  const { db, merchantId } = await setupCommitted(t);
  const sql = `INSERT INTO merchant_locations
                 (merchant_id, label, address_text, is_default_pickup)
               VALUES ($1, $2, $3, TRUE)`;
  await proveSecondInsertWaitsThenUniqueFails(t, {
    firstSql: sql, firstParams: [merchantId, 'A', 'Synthetic address A'],
    secondSql: sql, secondParams: [merchantId, 'B', 'Synthetic address B'],
    constraint: 'merchant_locations_one_active_default_uq',
  });
  assert.equal((await db.query(
    `SELECT count(*)::int AS n FROM merchant_locations
      WHERE merchant_id=$1 AND status='ACTIVE' AND is_default_pickup=TRUE`,
    [merchantId],
  )).rows[0].n, 1);
});

test('concurrency: serialized default-location switches leave exactly one final default', { skip: SKIP }, async (t) => {
  const setup = await newClient();
  const adminId = (await setup.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;
  const merchant = await createMerchant(setup, { displayName: `Merchant ${randomUUID()}` });
  await createMerchantMembership(setup, { merchantId: merchant.id, userId: adminId, membershipRole: 'ADMIN' });
  await setMerchantStatus(setup, merchant.id, 'ACTIVE');
  const locationA = await createMerchantLocation(setup, {
    merchantId: merchant.id, label: 'A', addressText: 'Synthetic address A', isDefaultPickup: true,
  });
  const locationB = await createMerchantLocation(setup, {
    merchantId: merchant.id, label: 'B', addressText: 'Synthetic address B', isDefaultPickup: false,
  });

  t.after(async () => {
    await setup.query(`UPDATE merchants SET status='CLOSED' WHERE id=$1 AND status<>'CLOSED'`, [merchant.id]).catch(() => {});
    await setup.query(`DELETE FROM merchant_locations WHERE merchant_id=$1`, [merchant.id]).catch(() => {});
    await setup.query(`DELETE FROM merchant_memberships WHERE merchant_id=$1`, [merchant.id]).catch(() => {});
    await setup.query(`DELETE FROM merchants WHERE id=$1`, [merchant.id]).catch(() => {});
    await setup.query(`DELETE FROM users WHERE id=$1`, [adminId]).catch(() => {});
    await setup.end();
  });

  const a = await newClient();
  const b = await newClient();
  t.after(async () => { await a.end().catch(() => {}); await b.end().catch(() => {}); });
  await a.query('BEGIN');
  await b.query('BEGIN');

  await lockMerchantById(a, merchant.id);
  const targetB = await lockMerchantLocationById(a, locationB.id);
  assert.equal(targetB.merchant_id, merchant.id);
  assert.equal(targetB.status, 'ACTIVE');
  await clearActiveDefaultMerchantLocation(a, merchant.id);
  assert.ok(await setMerchantLocationDefault(a, { merchantId: merchant.id, locationId: locationB.id }));

  let settled = false;
  const switchBack = (async () => {
    await lockMerchantById(b, merchant.id);
    const targetA = await lockMerchantLocationById(b, locationA.id);
    assert.equal(targetA.merchant_id, merchant.id);
    assert.equal(targetA.status, 'ACTIVE');
    await clearActiveDefaultMerchantLocation(b, merchant.id);
    const selected = await setMerchantLocationDefault(b, { merchantId: merchant.id, locationId: locationA.id });
    return selected;
  })().then(
    (value) => { settled = true; return { ok: true, value, error: null }; },
    (error) => { settled = true; return { ok: false, value: null, error }; },
  );

  await delay(75);
  assert.equal(settled, false, 'second default switch must wait on the merchant authority lock');
  await a.query('COMMIT');
  const outcome = await switchBack;
  assert.equal(outcome.ok, true, `second default switch should succeed once the first commits: ${outcome.error?.stack || outcome.error}`);
  assert.equal(outcome.value.id, locationA.id);
  await b.query('COMMIT');

  const defaults = (await setup.query(
    `SELECT id FROM merchant_locations
      WHERE merchant_id=$1 AND status='ACTIVE' AND is_default_pickup=TRUE`, [merchant.id],
  )).rows;
  assert.deepEqual(defaults.map((row) => row.id), [locationA.id]);
});


test('concurrency: VERIFIED channel proof survives a concurrent user-link write', { skip: SKIP }, async (t) => {
  const setup = await newClient();
  const userId = (await setup.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;
  const ns = `ns-${randomUUID()}`;
  const key = `subject-${randomUUID()}`;
  const identityId = (await setup.query(
    `INSERT INTO external_contact_identities (channel, subject_namespace, canonical_subject_key)
     VALUES ('WHATSAPP', $1, $2) RETURNING id`, [ns, key],
  )).rows[0].id;
  t.after(async () => {
    await setup.query(`DELETE FROM external_contact_identities WHERE id=$1`, [identityId]).catch(() => {});
    await setup.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => {});
    await setup.end();
  });

  const a = await newClient();
  const b = await newClient();
  t.after(async () => { await a.end().catch(() => {}); await b.end().catch(() => {}); });
  await a.query('BEGIN');
  await b.query('BEGIN');
  await a.query(`UPDATE external_contact_identities SET channel_proof='VERIFIED' WHERE id=$1`, [identityId]);
  let settled = false;
  const link = b.query(
    `UPDATE external_contact_identities SET linked_user_id=$2, linked_at=now()
      WHERE id=$1 AND status='ACTIVE' AND linked_user_id IS NULL RETURNING id`,
    [identityId, userId],
  ).then(
    (value) => { settled = true; return { ok: true, value, error: null }; },
    (error) => { settled = true; return { ok: false, value: null, error }; },
  );
  await delay(75);
  assert.equal(settled, false, 'concurrent link must serialize on the same identity row');
  await a.query('COMMIT');
  const outcome = await link;
  assert.equal(outcome.ok, true, `concurrent link should succeed once the first commits: ${outcome.error?.stack || outcome.error}`);
  assert.equal(outcome.value.rowCount, 1);
  await b.query('COMMIT');
  const row = (await setup.query(
    `SELECT channel_proof, linked_user_id FROM external_contact_identities WHERE id=$1`, [identityId],
  )).rows[0];
  assert.equal(row.channel_proof, 'VERIFIED');
  assert.equal(row.linked_user_id, userId);
});

test('concurrency: two different user-link attempts cannot overwrite the first proven link', { skip: SKIP }, async (t) => {
  const setup = await newClient();
  const userA = (await setup.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;
  const userB = (await setup.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;
  const ns = `ns-${randomUUID()}`;
  const key = `subject-${randomUUID()}`;
  const identityId = (await setup.query(
    `INSERT INTO external_contact_identities (channel, subject_namespace, canonical_subject_key, channel_proof)
     VALUES ('WHATSAPP', $1, $2, 'VERIFIED') RETURNING id`, [ns, key],
  )).rows[0].id;
  t.after(async () => {
    await setup.query(`DELETE FROM external_contact_identities WHERE id=$1`, [identityId]).catch(() => {});
    await setup.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[userA, userB]]).catch(() => {});
    await setup.end();
  });

  const a = await newClient();
  const b = await newClient();
  t.after(async () => { await a.end().catch(() => {}); await b.end().catch(() => {}); });
  await a.query('BEGIN');
  await b.query('BEGIN');
  const sql = `UPDATE external_contact_identities SET linked_user_id=$2, linked_at=now()
                WHERE id=$1 AND status='ACTIVE' AND linked_user_id IS NULL RETURNING linked_user_id`;
  assert.equal((await a.query(sql, [identityId, userA])).rowCount, 1);
  let settled = false;
  const second = b.query(sql, [identityId, userB]).then(
    (value) => { settled = true; return { ok: true, value, error: null }; },
    (error) => { settled = true; return { ok: false, value: null, error }; },
  );
  await delay(75);
  assert.equal(settled, false);
  await a.query('COMMIT');
  const outcome = await second;
  assert.equal(outcome.ok, true, `second competing link should complete without error: ${outcome.error?.stack || outcome.error}`);
  assert.equal(outcome.value.rowCount, 0);
  await b.query('COMMIT');
  assert.equal((await setup.query(
    `SELECT linked_user_id FROM external_contact_identities WHERE id=$1`, [identityId],
  )).rows[0].linked_user_id, userA);
});

test('concurrency: DB backstop serializes two ADMIN revocations and preserves one ACTIVE ADMIN', { skip: SKIP }, async (t) => {
  const setup = await newClient();
  const adminA = (await setup.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;
  const adminB = (await setup.query(`INSERT INTO users DEFAULT VALUES RETURNING id`)).rows[0].id;
  const merchantId = (await setup.query(
    `INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`Merchant ${randomUUID()}`],
  )).rows[0].id;
  const memberships = (await setup.query(
    `INSERT INTO merchant_memberships (merchant_id, user_id, membership_role)
     VALUES ($1,$2,'ADMIN'),($1,$3,'ADMIN') RETURNING id, user_id`, [merchantId, adminA, adminB],
  )).rows;
  await setup.query(`UPDATE merchants SET status='ACTIVE' WHERE id=$1`, [merchantId]);
  const membershipA = memberships.find((row) => row.user_id === adminA).id;
  const membershipB = memberships.find((row) => row.user_id === adminB).id;

  t.after(async () => {
    await setup.query(`UPDATE merchants SET status='CLOSED' WHERE id=$1 AND status<>'CLOSED'`, [merchantId]).catch(() => {});
    await setup.query(`DELETE FROM merchant_memberships WHERE merchant_id=$1`, [merchantId]).catch(() => {});
    await setup.query(`DELETE FROM merchants WHERE id=$1`, [merchantId]).catch(() => {});
    await setup.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[adminA, adminB]]).catch(() => {});
    await setup.end();
  });

  const a = await newClient();
  const b = await newClient();
  t.after(async () => { await a.end().catch(() => {}); await b.end().catch(() => {}); });
  await a.query('BEGIN');
  await b.query('BEGIN');
  assert.equal((await a.query(
    `UPDATE merchant_memberships SET status='REVOKED', revoked_at=now()
      WHERE id=$1 AND status='ACTIVE' RETURNING id`, [membershipA],
  )).rowCount, 1);

  let settled = false;
  const second = b.query(
    `UPDATE merchant_memberships SET status='REVOKED', revoked_at=now()
      WHERE id=$1 AND status='ACTIVE' RETURNING id`, [membershipB],
  ).then(
    (value) => { settled = true; return { ok: true, value, error: null }; },
    (error) => { settled = true; return { ok: false, value: null, error }; },
  );
  await delay(75);
  assert.equal(settled, false, 'second ADMIN revoke must wait on the merchant authority lock');
  await a.query('COMMIT');
  const outcome = await second;
  assert.equal(outcome.ok, false, 'second ADMIN revoke must fail once the first revocation commits');
  assert.equal(
    outcome.error.code, '23514',
    `expected PostgreSQL 23514, got ${outcome.error?.code}: ${outcome.error?.message}`,
  );
  assert.match(outcome.error.message, /last ACTIVE ADMIN/);
  await b.query('ROLLBACK').catch(() => {});

  assert.equal((await setup.query(
    `SELECT count(*)::int AS n FROM merchant_memberships
      WHERE merchant_id=$1 AND status='ACTIVE' AND membership_role='ADMIN'`, [merchantId],
  )).rows[0].n, 1);
});


test('binding revoke is terminal and a later re-bind is a new row', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  const key = `subject-${randomUUID()}`;
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business', canonicalSubjectKey: key,
  });
  const first = await createMerchantContactBinding(db, {
    merchantId: merchant.id, externalContactIdentityId: identity.id,
    relationship: 'CONTACT', provenance: 'synthetic-test-bootstrap',
  });
  await assertPgCodeInTxn(
    db,
    () => db.query(`UPDATE merchant_contact_bindings SET relationship='OPERATOR' WHERE id=$1`, [first.id]),
    '23514', 'relationship',
  );
  await revokeMerchantContactBinding(db, first.id);
  await assertPgCodeInTxn(
    db,
    () => db.query(`UPDATE merchant_contact_bindings SET status='ACTIVE', revoked_at=NULL WHERE id=$1`, [first.id]),
    '23514', 'terminal',
  );
  const second = await createMerchantContactBinding(db, {
    merchantId: merchant.id, externalContactIdentityId: identity.id,
    relationship: 'CONTACT', provenance: 'synthetic-test-rebind',
  });
  assert.notEqual(first.id, second.id);
});

test('FK history RESTRICT: user referenced by membership cannot be deleted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const userId = await insertUser(db);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  await createMerchantMembership(db, { merchantId: merchant.id, userId, membershipRole: 'ADMIN' });
  await assertPgCode(db.query(`DELETE FROM users WHERE id=$1`, [userId]), '23503');
});

test('FK history RESTRICT: linked user referenced by external identity cannot be deleted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const userId = await insertUser(db);
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business',
    canonicalSubjectKey: `subject-${randomUUID()}`,
  });
  await linkExternalContactToUser(db, { identityId: identity.id, userId });
  await assertPgCode(db.query(`DELETE FROM users WHERE id=$1`, [userId]), '23503');
});

test('FK history RESTRICT: merchant referenced by location cannot be deleted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  await createMerchantLocation(db, {
    merchantId: merchant.id, label: 'A', addressText: 'Synthetic address A',
  });
  await assertPgCode(db.query(`DELETE FROM merchants WHERE id=$1`, [merchant.id]), '23503');
});

test('FK history RESTRICT: merchant referenced by contact binding cannot be deleted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business',
    canonicalSubjectKey: `subject-${randomUUID()}`,
  });
  await createMerchantContactBinding(db, {
    merchantId: merchant.id, externalContactIdentityId: identity.id,
    provenance: 'synthetic-fk-test',
  });
  await assertPgCode(db.query(`DELETE FROM merchants WHERE id=$1`, [merchant.id]), '23503');
});

test('FK history RESTRICT: external identity referenced by binding cannot be deleted', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  const merchant = await createMerchant(db, { displayName: 'Synthetic Merchant' });
  const identity = await createExternalContactIdentity(db, {
    channel: 'WHATSAPP', subjectNamespace: 'synthetic-business',
    canonicalSubjectKey: `subject-${randomUUID()}`,
  });
  await createMerchantContactBinding(db, {
    merchantId: merchant.id, externalContactIdentityId: identity.id,
    provenance: 'synthetic-fk-test',
  });
  await assertPgCode(db.query(`DELETE FROM external_contact_identities WHERE id=$1`, [identity.id]), '23503');
});

test('phone metadata accepts only canonical E.164-ish +digits form', { skip: SKIP }, async (t) => {
  const db = await beginTxn(t);
  await assertPgCode(
    db.query(
      `INSERT INTO external_contact_identities
         (channel, subject_namespace, canonical_subject_key, phone_e164)
       VALUES ('SMS', 'sms:e164', '+15550001234', '1 (555) 000-1234')`,
    ),
    '23514', 'external_contact_identities_phone_check',
  );
});

// The runner applies all migration files in sorted order. A numeric gap at 0008 is intentional:
// 0008 is reserved by the frozen vehicle-block-state contract, while this slice owns 0009.
test('migration slot: merchant authority is 0009 and no 0008 merchant migration exists', async () => {
  const { readFile, access } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const migrationUrl = new URL('../migrations/0009_merchant_identity_contact_authority.sql', import.meta.url);
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /BD-MERCHANT-IDENTITY-CONTACT-AUTHORITY-01B/);
  const forbiddenUrl = new URL('../migrations/0008_merchant_identity_contact_authority.sql', import.meta.url);
  await assert.rejects(access(fileURLToPath(forbiddenUrl)));
});
