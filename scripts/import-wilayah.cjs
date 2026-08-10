#!/usr/bin/env node
/**
 * Import data referensi wilayah Indonesia ke ref_provinces / ref_regencies /
 * ref_districts / ref_villages.
 *
 *   node scripts/import-wilayah.cjs [--dir <folder>] [--prune] [--dry-run]
 *   npm run db:import:wilayah
 *
 * Sumber data: file lokal di infra/db/seeds/regions/ — CSV atau JSON, keduanya
 * dikenali dari ekstensi (CSV diprioritaskan bila dua-duanya ada). Script ini
 * TIDAK pernah menghubungi API eksternal saat runtime: form produksi harus
 * membaca dari tabel referensi, bukan dari internet. Cara memperbarui dataset
 * (unduh manual → konversi → jalankan script ini) ada di
 * infra/db/seeds/regions/README.md, lengkap dengan atribusi sumbernya.
 *
 * Sifat: idempotent (INSERT ... ON CONFLICT DO UPDATE). Baris yang ada di DB
 * tapi tidak ada di file TIDAK dihapus kecuali --prune diberikan eksplisit.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config();

const args = process.argv.slice(2);
const PRUNE = args.includes('--prune');
const DRY_RUN = args.includes('--dry-run');
const dirIdx = args.indexOf('--dir');
const SEED_DIR =
  dirIdx >= 0 && args[dirIdx + 1]
    ? path.resolve(args[dirIdx + 1])
    : path.join(__dirname, '..', 'infra', 'db', 'seeds', 'regions');

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

function parseCsv(text) {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines
    .slice(1)
    .map((line) => {
      const values = line.split(',');
      const row = {};
      headers.forEach((h, i) => {
        row[h] = (values[i] || '').trim();
      });
      return row;
    })
    .filter((row) => Object.values(row).some((v) => v));
}

/** Baca <name>.csv atau <name>.json dari SEED_DIR. CSV menang bila keduanya ada. */
function readSource(name) {
  for (const ext of ['csv', 'json']) {
    const file = path.join(SEED_DIR, `${name}.${ext}`);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const rows = ext === 'csv' ? parseCsv(text) : JSON.parse(text);
    if (!Array.isArray(rows)) throw new Error(`${file}: JSON harus berupa array objek`);
    return { file, rows };
  }
  return null;
}

// Satu definisi per level: nama file, tabel, kolom, dan cara memetakan baris.
// `parent` dipakai untuk urutan import & prune (anak dulu saat menghapus).
const LEVELS = [
  {
    name: 'provinces',
    table: 'ref_provinces',
    columns: ['code', 'name'],
    map: (r) => [r.code, r.name],
  },
  {
    name: 'regencies',
    table: 'ref_regencies',
    columns: ['code', 'province_code', 'name', 'type'],
    map: (r) => [r.code, r.province_code, r.name, r.type || null],
  },
  {
    name: 'districts',
    table: 'ref_districts',
    columns: ['code', 'regency_code', 'name'],
    map: (r) => [r.code, r.regency_code, r.name],
  },
  {
    name: 'villages',
    table: 'ref_villages',
    columns: ['code', 'district_code', 'name', 'type'],
    map: (r) => [r.code, r.district_code, r.name, r.type || null],
  },
];

/**
 * `xmax = 0` benar hanya untuk baris yang benar-benar di-INSERT; pada jalur
 * DO UPDATE xmax terisi id transaksi. Itulah cara membedakan inserted vs
 * updated tanpa query hitung terpisah.
 */
async function upsertLevel(client, level) {
  const src = readSource(level.name);
  if (!src) {
    console.log(`  ${level.name.padEnd(10)} — tidak ada file, dilewati`);
    return null;
  }

  const cols = level.columns;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const updates = cols
    .filter((c) => c !== 'code')
    .map((c) => `${c} = EXCLUDED.${c}`)
    .concat('updated_at = now()')
    .join(', ');
  const sql = `INSERT INTO ${level.table} (${cols.join(', ')})
               VALUES (${placeholders})
               ON CONFLICT (code) DO UPDATE SET ${updates}
               RETURNING (xmax = 0) AS inserted`;

  let inserted = 0;
  let updated = 0;
  const codes = [];
  for (const row of src.rows) {
    const params = level.map(row);
    if (!params[0]) continue; // baris tanpa code = baris kosong
    codes.push(String(params[0]));
    if (DRY_RUN) continue;
    const { rows } = await client.query(sql, params);
    if (rows[0].inserted) inserted++;
    else updated++;
  }

  console.log(
    `  ${level.name.padEnd(10)} ${String(codes.length).padStart(6)} baris` +
      (DRY_RUN ? '  (dry-run, tidak ditulis)' : `  → ${inserted} inserted, ${updated} updated`),
  );
  return { level, codes };
}

/** Hapus baris yang tidak ada di file. Anak dulu supaya tidak menggantung. */
async function prune(client, results) {
  console.log('\n--prune: menghapus baris yang tidak ada di file sumber');
  let total = 0;
  for (const r of [...results].reverse()) {
    if (!r) continue;
    if (DRY_RUN) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM ${r.level.table} WHERE NOT (code = ANY($1))`,
        [r.codes],
      );
      console.log(`  ${r.level.name.padEnd(10)} ${rows[0].n} baris akan dihapus (dry-run)`);
      continue;
    }
    const { rowCount } = await client.query(
      `DELETE FROM ${r.level.table} WHERE NOT (code = ANY($1))`,
      [r.codes],
    );
    total += rowCount ?? 0;
    console.log(`  ${r.level.name.padEnd(10)} ${rowCount} baris dihapus`);
  }
  if (!DRY_RUN) console.log(`  total dihapus: ${total}`);
}

(async () => {
  console.log(`Import wilayah dari ${SEED_DIR}`);
  if (DRY_RUN) console.log('MODE DRY-RUN — tidak ada perubahan yang ditulis.\n');

  const client = new Client(buildPgConfig());
  await client.connect();
  try {
    const results = [];
    for (const level of LEVELS) results.push(await upsertLevel(client, level));

    if (results.every((r) => r === null)) {
      throw new Error(
        `Tidak ada file sumber di ${SEED_DIR}. Harapkan provinces/regencies/districts/villages berekstensi .csv atau .json`,
      );
    }
    if (PRUNE) await prune(client, results);
    else console.log('\n(tanpa --prune: baris yang tidak ada di file dibiarkan)');

    console.log('\nSelesai.');
  } finally {
    await client.end();
  }
})().catch((e) => {
  console.error('Import error:', e.message);
  process.exit(1);
});
