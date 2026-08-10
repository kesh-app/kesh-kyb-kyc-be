#!/usr/bin/env node
/**
 * Konversi dump SQL cahyadsn/wilayah → 4 file JSON yang dibaca
 * scripts/import-wilayah.cjs.
 *
 *   node scripts/convert-wilayah-source.cjs <wilayah.sql> [--out <dir>]
 *
 * Dump sumber memakai SATU tabel datar `wilayah (kode, nama)` dengan kode
 * bertitik ala Kemendagri, dan level ditentukan dari jumlah segmen:
 *
 *   11              → provinsi   (2 digit)
 *   11.01           → kab/kota   (4 digit)
 *   11.01.01        → kecamatan  (6 digit)
 *   11.01.01.2001   → desa/kel   (10 digit)
 *
 * Titik dibuang supaya cocok dengan kolom code di ref_* yang sudah ada.
 *
 * Script ini OFFLINE-ONLY dan dijalankan manual saat refresh dataset. Runtime
 * aplikasi tidak pernah memanggilnya — lihat infra/db/seeds/regions/README.md.
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const srcFile = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const OUT_DIR =
  outIdx >= 0 && args[outIdx + 1]
    ? path.resolve(args[outIdx + 1])
    : path.join(__dirname, '..', 'infra', 'db', 'seeds', 'regions');

if (!srcFile) {
  console.error('Usage: node scripts/convert-wilayah-source.cjs <wilayah.sql> [--out <dir>]');
  process.exit(1);
}

/** Baris data: ('11.01.01.2001','Keude Bakongan'), — kutip tunggal di-escape ''. */
const ROW_RE = /^\s*\('([\d.]+)','((?:[^']|'')*)'\)[,;]?\s*$/;

function parseDump(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    rows.push({ kode: m[1], nama: m[2].replace(/''/g, "'").trim() });
  }
  return rows;
}

/**
 * Ditulis sebagai JSON, bukan CSV: dataset resmi memuat nama wilayah yang
 * mengandung koma (mis. "Lubuk Pakam I,II" dan "Lambang Sari I, II, III") dan
 * parser CSV importer memakai split(',') polos, sehingga baris itu akan pecah
 * ke kolom yang salah tanpa suara. JSON menghindarinya tanpa perlu quoting.
 */
function writeJson(name, fields, rows) {
  const file = path.join(OUT_DIR, `${name}.json`);
  const objects = rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
  fs.writeFileSync(file, JSON.stringify(objects, null, 0) + '\n');
  console.log(`  ${name.padEnd(10)} ${String(rows.length).padStart(6)} baris → ${file}`);
  return rows.length;
}

const text = fs.readFileSync(path.resolve(srcFile), 'utf8');
const all = parseDump(text);
if (!all.length) throw new Error(`Tidak ada baris data yang terbaca dari ${srcFile}`);
console.log(`Terbaca ${all.length} baris dari ${srcFile}\n`);

const strip = (k) => k.replace(/\./g, '');
const parentOf = (k) => strip(k.split('.').slice(0, -1).join('.'));
const bySegments = (n) => all.filter((r) => r.kode.split('.').length === n);

// Segmen ke-4 kode desa: 1xxx = Kelurahan, 2xxx = Desa (konvensi Kemendagri).
const villageType = (kode) => (kode.split('.')[3].startsWith('1') ? 'KELURAHAN' : 'DESA');
// Kab/Kota dibedakan dari prefiks namanya, sama seperti seed lama.
const regencyType = (nama) => (/^kota\b/i.test(nama) ? 'KOTA' : 'KABUPATEN');

fs.mkdirSync(OUT_DIR, { recursive: true });

const counts = {
  provinces: writeJson(
    'provinces',
    ['code', 'name'],
    bySegments(1).map((r) => [strip(r.kode), r.nama]),
  ),
  regencies: writeJson(
    'regencies',
    ['code', 'province_code', 'name', 'type'],
    bySegments(2).map((r) => [strip(r.kode), parentOf(r.kode), r.nama, regencyType(r.nama)]),
  ),
  districts: writeJson(
    'districts',
    ['code', 'regency_code', 'name'],
    bySegments(3).map((r) => [strip(r.kode), parentOf(r.kode), r.nama]),
  ),
  villages: writeJson(
    'villages',
    ['code', 'district_code', 'name', 'type'],
    bySegments(4).map((r) => [strip(r.kode), parentOf(r.kode), r.nama, villageType(r.kode)]),
  ),
};

const kota = bySegments(2).filter((r) => regencyType(r.nama) === 'KOTA').length;
const kelurahan = bySegments(4).filter((r) => villageType(r.kode) === 'KELURAHAN').length;
console.log(
  `\nRingkasan: ${counts.provinces} provinsi, ${counts.regencies} kab/kota ` +
    `(${counts.regencies - kota} kabupaten + ${kota} kota), ${counts.districts} kecamatan, ` +
    `${counts.villages} desa/kelurahan (${kelurahan} kelurahan + ${counts.villages - kelurahan} desa)`,
);
