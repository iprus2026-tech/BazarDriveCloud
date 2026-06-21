// /server/scripts/seed.mjs — dev seed (ADR BD-DOCS-041 layout). Mirrors mock_api fixtures
// into the DB for local development. Phase 1: the app entities are not migrated yet (the
// client cutover is gated by #636) and the users table is a stub, so there are no
// client-facing fixtures to insert without guessing the per-entity column shapes — each
// entity registers its own seeder as its module PR lands. This stub establishes the
// script + DATABASE_URL contract and verifies connectivity; it inserts nothing.
import pg from 'pg';

const { Client } = pg;

// Per-entity seeders append here as their repositories land (posts, orders, ...).
const SEEDERS = [
  // { name: 'posts', run: async (client) => { /* INSERT ... */ } },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('SELECT 1'); // connectivity check
    if (SEEDERS.length === 0) {
      console.log('no seeders registered yet — entity seeds land with their module PRs');
      return;
    }
    for (const seeder of SEEDERS) {
      process.stdout.write(`── seeding ${seeder.name}\n`);
      await seeder.run(client);
    }
    console.log(`seeded ${SEEDERS.length} ${SEEDERS.length === 1 ? 'entity' : 'entities'}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
