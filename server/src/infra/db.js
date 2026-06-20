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

    // Readiness ping (used by /readyz).
    async ping() {
      const { rows } = await pool.query('SELECT 1 AS ok');
      return rows[0]?.ok === 1;
    },
  };

  app.decorate('db', db);
  app.addHook('onClose', async () => { await pool.end(); });
}

export default fp(dbPlugin, { name: 'db' });
