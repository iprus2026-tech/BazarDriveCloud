// DB-gated end-to-end flow for BD-DRIVER-DOCUMENT-COMPLIANCE-01B (#955).
// Runs through the real Fastify auth/session seam and real PostgreSQL migration.
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

async function mintSession(app, phone) {
  const requested = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/request',
    payload: { phone },
  });
  assert.equal(requested.statusCode, 200);
  const code = requested.json().devCode;
  const verified = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/otp/verify',
    payload: { phone, code },
  });
  assert.equal(verified.statusCode, 200);
  return verified.json();
}

const getCompliance = (app, token) => app.inject({
  method: 'GET',
  url: '/api/v1/safety/driver/compliance',
  headers: { authorization: `Bearer ${token}` },
});

async function expectCheckViolation(promise, message) {
  await assert.rejects(
    promise,
    (error) => error?.code === '23514',
    message,
  );
}

test('self-scoped compliance projection over real PostgreSQL', { skip: SKIP }, async (t) => {
  const app = await buildApp({ config });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  const suffix = String(process.pid).padStart(7, '0');
  const phone = `+1583${suffix}`;
  const otherPhone = `+1584${suffix}`;
  const userIds = [];

  t.after(async () => {
    if (userIds.length) {
      await db.query('DELETE FROM auth_session WHERE user_id = ANY($1::uuid[])', [userIds]).catch(() => {});
      await db.query('DELETE FROM driver_documents WHERE driver_id = ANY($1::uuid[])', [userIds]).catch(() => {});
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]).catch(() => {});
    }
    await db.query('DELETE FROM auth_otp WHERE phone = ANY($1::text[])', [[phone, otherPhone]]).catch(() => {});
    await db.end();
    await app.close();
  });

  const me = await mintSession(app, phone);
  userIds.push(me.user.userId);

  const empty = await getCompliance(app, me.token);
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.headers['cache-control'], 'no-store');
  assert.equal(empty.json().driverId, me.user.userId);
  assert.equal(empty.json().documents.length, 5);
  assert.deepEqual(empty.json().documents.map((d) => d.status), Array(5).fill('MISSING'));
  assert.equal(empty.json().lineReady, false);

  // Database owns the state vocabulary and shift validity boundary.
  await expectCheckViolation(
    db.query(
      `INSERT INTO driver_documents
         (driver_id, document_type, status, verified_at, verification_source)
       VALUES ($1, 'WAYBILL', 'VALID', clock_timestamp(), 'test-suite')`,
      [me.user.userId],
    ),
    'a shift-scoped VALID record without valid_until must be rejected',
  );
  await expectCheckViolation(
    db.query(
      `INSERT INTO driver_documents
         (driver_id, document_type, status)
       VALUES ($1, 'DRIVER_LICENSE', 'MISSING')`,
      [me.user.userId],
    ),
    'MISSING must remain synthesized rather than persisted',
  );

  const documents = [
    ['DRIVER_LICENSE', 'EXPIRING', '365 days', '7 days'],
    ['TAXI_OSAGO', 'VALID', '365 days', '365 days'],
    ['TAXI_REGISTRY', 'VALID', '365 days', '365 days'],
    ['WAYBILL', 'VALID', '8 hours', '8 hours'],
    ['MEDICAL_CHECK', 'VALID', '8 hours', '8 hours'],
  ];

  for (const [type, status, validFromBack, validUntilForward] of documents) {
    await db.query(
      `INSERT INTO driver_documents
         (driver_id, document_type, status, valid_from, valid_until,
          issued_at, verified_at, verification_source, object_key)
       VALUES (
         $1, $2, $3,
         clock_timestamp() - $4::interval,
         clock_timestamp() + $5::interval,
         clock_timestamp() - interval '1 day',
         clock_timestamp(), 'test-suite', $6
       )`,
      [
        me.user.userId,
        type,
        status,
        validFromBack,
        validUntilForward,
        `private/test/${me.user.userId}/${type}`,
      ],
    );
  }

  const ready = await getCompliance(app, me.token);
  assert.equal(ready.statusCode, 200);
  const readyBody = ready.json();
  assert.equal(readyBody.documentsReady, true);
  assert.equal(readyBody.shiftReady, true);
  assert.equal(readyBody.lineReady, true);
  assert.deepEqual(readyBody.blockingReasons, []);
  assert.deepEqual(readyBody.warnings, ['DRIVER_LICENSE_EXPIRING_SOON']);

  // The repository selects a safe subset and the response schema is closed.
  const serialized = JSON.stringify(readyBody);
  assert.equal(serialized.includes('objectKey'), false);
  assert.equal(serialized.includes('object_key'), false);
  assert.equal(serialized.includes('verificationSource'), false);
  assert.equal(serialized.includes('verification_source'), false);
  assert.equal(serialized.includes('private/test/'), false);
  assert.equal(serialized.includes('test-suite'), false);

  // Expiry is fail-closed immediately. It does not depend on the future expiry
  // worker having already normalized every stored row.
  await db.query(
    `UPDATE driver_documents
        SET status = 'VALID', valid_until = clock_timestamp() - interval '1 minute'
      WHERE driver_id = $1 AND document_type = 'MEDICAL_CHECK'`,
    [me.user.userId],
  );
  const expired = (await getCompliance(app, me.token)).json();
  assert.equal(expired.documentsReady, true);
  assert.equal(expired.shiftReady, false);
  assert.equal(expired.lineReady, false);
  assert.deepEqual(expired.blockingReasons, ['MEDICAL_CHECK_EXPIRED']);
  assert.equal(
    expired.documents.find((d) => d.type === 'MEDICAL_CHECK').status,
    'EXPIRED',
  );

  // A second authenticated identity receives only its own all-MISSING projection.
  const other = await mintSession(app, otherPhone);
  userIds.push(other.user.userId);
  const otherBody = (await getCompliance(app, other.token)).json();
  assert.equal(otherBody.driverId, other.user.userId);
  assert.equal(otherBody.lineReady, false);
  assert.deepEqual(otherBody.documents.map((d) => d.status), Array(5).fill('MISSING'));
});
