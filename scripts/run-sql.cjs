#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

function buildPgConfig() {
  // pakai DATABASE_URL kalau ada, otherwise PG*
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

(async () => {
  const client = new Client(buildPgConfig());
  await client.connect();

  const dir = path.join(__dirname, '..', 'infra', 'db', 'migrations');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    console.log('Applying', f);
    await client.query(sql);
    console.log('Done', f);
  }
  await client.end();
  console.log('All migrations applied.');
})().catch(e => {
  console.error('Migration error:', e);
  process.exit(1);
});
