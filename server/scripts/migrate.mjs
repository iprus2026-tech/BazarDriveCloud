// /server/scripts/migrate.mjs — apply server/migrations/*.sql in sorted order against
// DATABASE_URL (the npm-run-migrate / docker entry). The migrations are idempotent per
// their own headers, so re-runs are safe. No framework — plain `pg`, matching the repo's
// zero-build ethos. server-ci also applies the same files via psql; this validates the
// Node runner end-to-end.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const { Client } = pg;
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '..', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.log('no migrations found');
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of files) {
      process.stdout.write(`── applying ${file}\n`);
      await client.query(await readFile(path.join(migrationsDir, file), 'utf8'));
    }
    console.log(`applied ${files.length} migration(s)`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
