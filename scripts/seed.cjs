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

  // 🔹 roles idempotent – sekalian tambahin role finance & SystemAdmin
  const roles = [
    'BranchAdmin',
    'FrontDesk',
    'ComplianceLead',
    'Auditor',
    'FinanceStaff',
    'FinanceManager',
    'SystemAdmin',
    'Director',
  ];
  for (const r of roles) {
    await client.query(
      'INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING',
      [r]
    );
  }

  // 🔹 branch MAIN
  await client.query(
    `INSERT INTO branches(code, name, city)
     VALUES($1,$2,$3)
     ON CONFLICT (code) DO NOTHING`,
    ['MAIN', 'Main Branch', 'Jakarta']
  );

  // 🔹 admin Compliance default (boleh dipertahankan untuk testing)
  const emailCompliance = 'admin@example.com'.toLowerCase();
  const hashCompliance = await bcrypt.hash('Admin123!', 10);
  await client.query(
    `INSERT INTO users(name,email,password_hash,role,branch_id)
     VALUES($1,$2,$3,$4,(SELECT id FROM branches WHERE code=$5))
     ON CONFLICT (email) DO NOTHING`,
    ['Default Compliance Admin', emailCompliance, hashCompliance, 'ComplianceLead', 'MAIN']
  );

  // 🔹 SystemAdmin default
  const sysEmail = 'sysadmin@kesh.local'.toLowerCase();
  // bisa override lewat env kalau mau: SEED_SYSADMIN_PASSWORD
  const sysPassword = process.env.SEED_SYSADMIN_PASSWORD || 'SystemAdmin@123';
  const sysHash = await bcrypt.hash(sysPassword, 10);

  await client.query(
    `INSERT INTO users(name,email,password_hash,role,branch_id)
     VALUES($1,$2,$3,$4,(SELECT id FROM branches WHERE code=$5))
     ON CONFLICT (email) DO NOTHING`,
    ['System Admin', sysEmail, sysHash, 'SystemAdmin', 'MAIN']
  );

  await client.end();
  console.log('Seeding complete.');
  console.log('SystemAdmin credentials:');
  console.log(`  email    : ${sysEmail}`);
  console.log(`  password : ${sysPassword}`);
})().catch(e => {
  console.error('Seed error:', e);
  process.exit(1);
});
