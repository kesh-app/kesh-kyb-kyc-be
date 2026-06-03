#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

function buildPgConfig() {
  const url = process.env.DATABASE_URL;
  if (url && url.trim()) return { connectionString: url.trim() };

  const cfg = {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || 'kesh-internal-local',
  };
  if (typeof cfg.password !== 'string' || cfg.password.length === 0) {
    throw new Error('Postgres password is missing. Set PGPASSWORD atau DATABASE_URL.');
  }
  return cfg;
}

// Sort by leading numeric prefix so "00014" (=14) sorts after "0013" (=13)
// and before "0015" (=15), regardless of zero-padding differences.
function numericPrefix(filename) {
  const m = filename.match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

(async () => {
  const client = new Client(buildPgConfig());
  await client.connect();

  // Ensure migration tracking table exists
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = path.join(__dirname, '..', 'infra', 'db', 'migrations');
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort((a, b) => numericPrefix(a) - numericPrefix(b));

  // Load already-applied migrations
  const { rows } = await client.query('SELECT filename FROM schema_migrations');
  const applied = new Set(rows.map(r => r.filename));

  let appliedCount = 0;
  let skippedCount = 0;

  for (const f of files) {
    if (applied.has(f)) {
      console.log('Skipping (already applied)', f);
      skippedCount++;
      continue;
    }

    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log('Applying', f);

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [f]
      );
      await client.query('COMMIT');
      console.log('Done', f);
      appliedCount++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`Migration error in ${f}:`, err.message);
      console.error('code:', err.code);
      await client.end();
      process.exit(1);
    }
  }

  await client.end();
  console.log(`\nAll migrations complete. Applied: ${appliedCount}, Skipped: ${skippedCount}.`);
})().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
