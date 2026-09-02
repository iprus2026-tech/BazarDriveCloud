// /server/src/infra/db.js — the pg Pool, decorated as fastify.db. This is the ONLY place
// that owns the connection; repositories/* receive `db` and own the SQL (the single seam
// for any future DB engine change). ACTIVE in Phase 1 (ADR BD-DOCS-041). The Pool is
// lazy — constructing it does not connect — so buildApp() is testable with no live
// database; the first query (or /readyz) opens a connection.
import fp from 'fastify-plugin';
import pg from 'pg';

const { Pool } = pg;

async function dbPlugin(app, opts) {
  const pool = new Pool({
    connectionString: opts.databaseUrl,
    max: opts.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // A pool 'error' on an idle client must not crash the process.
  pool.on('error', (err) => app.log.error({ err }, 'pg pool error'));

  const db = {
    query: (text, params) => pool.query(text, params),

    // Transaction helper for the multi-statement steps (e.g. the ACCEPTED assignment,
    // BD-DOCS-041): runs fn(client) inside BEGIN/COMMIT, ROLLBACK on throw.
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },

    // Readiness check (used by /readyz): connectivity AND every migration shape required by a
    // LIVE endpoint. In addition to auth/session, Ride events and the transactional outbox,
    // migration 0005's driver_documents table is now required because the narrow Safety &
    // Compliance read is live. A bare SELECT 1 would report a fresh or partially-migrated
    // database as ready while real requests fail.
    async ready() {
      const { rows } = await pool.query(
        `SELECT to_regclass('public.auth_session') IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'notification_outbox'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN (
                        'outbox_seq', 'source_event_id', 'occurred_at',
                        'immutable_envelope', 'immutable_digest', 'created_at'
                      )
                 ) = 6
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'notification_outbox_pkey'
                      AND pc.contype = 'p'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND pc.conname = 'notification_outbox_source_event_id_key'
                      AND pc.contype = 'u'
                 )
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_notification_outbox_no_mutation'
                      AND NOT t.tgisinternal
                 )
            )
            AND to_regprocedure(
              'public.notification_outbox_insert_guarded(uuid,jsonb,bytea,text)'
            ) IS NOT NULL
            AND EXISTS (
              SELECT 1
                FROM pg_constraint pc
                JOIN pg_class c ON c.oid = pc.conrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'ride_events'
                 AND pc.conname = 'ride_events_type_check'
                 AND pc.contype = 'c'
                 AND pg_get_constraintdef(pc.oid) LIKE '%status_change%'
            )
            AND EXISTS (
              SELECT 1
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public'
                 AND c.relname = 'driver_documents'
                 AND c.relkind = 'r'
                 AND (
                   SELECT count(*)
                     FROM pg_attribute a
                    WHERE a.attrelid = c.oid
                      AND a.attnum > 0
                      AND NOT a.attisdropped
                      AND a.attname IN (
                        'id', 'driver_id', 'document_type', 'status',
                        'valid_from', 'valid_until', 'issued_at', 'verified_at',
                        'verification_source', 'verification_reason', 'object_key',
                        'created_at', 'updated_at'
                      )
                 ) = 13
                 -- Readiness names every migration-0005 constraint, including
                 -- ownership, temporal, verification-metadata and PII-reference
                 -- guards. A table with only its headline PK/enum checks is not
                 -- safe enough to serve the live compliance projection.
                 AND (
                   SELECT count(*)
                     FROM pg_constraint pc
                    WHERE pc.conrelid = c.oid
                      AND (
                        (pc.contype = 'p' AND pc.conname IN (
                          'driver_documents_pkey'
                        ))
                        OR (pc.contype = 'f' AND pc.conname IN (
                          'driver_documents_driver_id_fkey'
                        ))
                        OR (pc.contype = 'u' AND pc.conname IN (
                          'driver_documents_driver_type_uq'
                        ))
                        OR (pc.contype = 'c' AND pc.conname IN (
                          'driver_documents_document_type_check',
                          'driver_documents_status_check',
                          'driver_documents_validity_range_check',
                          'driver_documents_shift_validity_check',
                          'driver_documents_expiring_validity_check',
                          'driver_documents_authoritative_metadata_check',
                          'driver_documents_rejected_reason_check',
                          'driver_documents_source_shape_check',
                          'driver_documents_reason_shape_check',
                          'driver_documents_object_key_shape_check'
                        ))
                      )
                 ) = 13
                 AND EXISTS (
                   SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = c.oid
                      AND t.tgname = 'trg_driver_documents_updated_at'
                      AND NOT t.tgisinternal
                 )
            )
            AND to_regclass('public.driver_documents_object_key_uq') IS NOT NULL
            AND to_regclass('public.idx_driver_documents_expiry') IS NOT NULL
          AS ok`,
      );
      return rows[0]?.ok === true;
    },
  };

  app.decorate('db', db);
  app.addHook('onClose', async () => { await pool.end(); });
}

export default fp(dbPlugin, { name: 'db' });
