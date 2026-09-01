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

    // Readiness check (used by /readyz): connectivity AND that the migrations the LIVE endpoints
    // depend on are applied — not just 0002's auth_session and 0003's widened
    // ride_events.type CHECK, but also 0004's transactional notification_outbox. Without that
    // final leg an env could report ready while every accepted Ride transition rolls back at the
    // outbox insert. A bare SELECT 1 would report a fresh, un-migrated database as ready.
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
            ) AS ok`,
      );
      return rows[0]?.ok === true;
    },
  };

  app.decorate('db', db);
  app.addHook('onClose', async () => { await pool.end(); });
}

export default fp(dbPlugin, { name: 'db' });
