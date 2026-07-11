#!/usr/bin/env node
/**
 * Imports region reference data from CSV files into the database.
 * Idempotent: uses INSERT ... ON CONFLICT DO UPDATE.
 * Run: npm run db:seed:regions
 *
 * Files: infra/db/seeds/regions/{provinces,regencies,districts,villages}.csv
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

function buildPgConfig() {
  const url = process.env.DATABASE_URL && process.env.DATABASE_URL.trim();
  if (url) return { connectionString: url };
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

function parseCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] || '').trim(); });
    return row;
  }).filter(row => Object.values(row).some(v => v));
}

const SEED_DIR = path.join(__dirname, '..', 'infra', 'db', 'seeds', 'regions');

async function upsertInBatches(client, table, rows, sql, paramsFn, label) {
  let count = 0;
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    for (const row of batch) {
      await client.query(sql, paramsFn(row));
      count++;
    }
  }
  console.log(`  ${label}: ${count} rows upserted`);
}

(async () => {
  const client = new Client(buildPgConfig());
  await client.connect();

  // provinces
  const provinces = parseCsv(path.join(SEED_DIR, 'provinces.csv'));
  await upsertInBatches(
    client, 'ref_provinces', provinces,
    `INSERT INTO ref_provinces (code, name)
     VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
    r => [r.code, r.name],
    'provinces'
  );

  // regencies
  const regencies = parseCsv(path.join(SEED_DIR, 'regencies.csv'));
  await upsertInBatches(
    client, 'ref_regencies', regencies,
    `INSERT INTO ref_regencies (code, province_code, name, type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type`,
    r => [r.code, r.province_code, r.name, r.type],
    'regencies'
  );

  // districts
  const districts = parseCsv(path.join(SEED_DIR, 'districts.csv'));
  await upsertInBatches(
    client, 'ref_districts', districts,
    `INSERT INTO ref_districts (code, regency_code, name)
     VALUES ($1, $2, $3)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
    r => [r.code, r.regency_code, r.name],
    'districts'
  );

  // villages
  const villages = parseCsv(path.join(SEED_DIR, 'villages.csv'));
  await upsertInBatches(
    client, 'ref_villages', villages,
    `INSERT INTO ref_villages (code, district_code, name, type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type`,
    r => [r.code, r.district_code, r.name, r.type],
    'villages'
  );

  await client.end();
  console.log('Region seed complete.');
})().catch(e => {
  console.error('Seed error:', e.message);
  process.exit(1);
});
