#!/usr/bin/env node
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
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

(async () => {
  const client = new Client(buildPgConfig());
  await client.connect();

  // roles idempotent
  const roles = ['BranchAdmin', 'ComplianceReviewer', 'ComplianceLead', 'Auditor'];
  for (const r of roles) {
    await client.query(
      'INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING',
      [r]
    );
  }

  // branch MAIN
  await client.query(
    `INSERT INTO branches(code, name, city)
     VALUES($1,$2,$3)
     ON CONFLICT (code) DO NOTHING`,
    ['MAIN', 'Main Branch', 'Jakarta']
  );

  // admin default
  const email = 'admin@example.com'.toLowerCase();
  const hash = await bcrypt.hash('Admin123!', 10);
  await client.query(
    `INSERT INTO users(name,email,password_hash,role,branch_id)
     VALUES($1,$2,$3,$4,(SELECT id FROM branches WHERE code=$5))
     ON CONFLICT (email) DO NOTHING`,
    ['System Admin', email, hash, 'ComplianceLead', 'MAIN']
  );

  await client.end();
  console.log('Seeding complete.');
})().catch(e => {
  console.error('Seed error:', e);
  process.exit(1);
});
