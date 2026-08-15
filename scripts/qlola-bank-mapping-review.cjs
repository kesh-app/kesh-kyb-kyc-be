/**
 * QA artifact generator — review pemetaan bank KESH → BIC BRI Qlola.
 *
 *   node scripts/qlola-bank-mapping-review.cjs
 *   → exports/qlola-bank-bic-mapping-review.csv
 *
 * Hanya untuk review internal manusia sebelum upload live ke Qlola. BUKAN data
 * runtime: exporter membaca tabel `ref_banks`, tidak pernah file ini.
 *
 * Sumber:
 *   - katalog bank KESH  : TransfersService.getBanks() (dibaca dari source)
 *   - baris BRI + BIC    : tabel ref_banks (di-seed dari sheet "Bank Code"
 *                          workbook `13-08-2026_Mass Transfer.xlsx`)
 *
 * Skrip ini sengaja tidak membaca workbook langsung supaya bisa dijalankan
 * siapa pun tanpa menyalin file Excel-nya.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const ROOT = path.join(__dirname, '..');

/**
 * Adjudikasi manual untuk pasangan yang TIDAK bisa diputuskan dari kecocokan
 * nama. Ditulis eksplisit agar tidak ada match manual yang lolos sebagai
 * "authoritative" tanpa alasan tertulis dan tanpa tingkat keyakinan.
 */
const ADJUDICATED = {
  NOBU: ['NORMALIZED_NAME', 'HIGH', 'Sheet BRI menulis "NATIONALNOBU"; Bank Nobu = PT Bank Nationalnobu. Substring, entitas sama.'],
  BSI: ['EXACT_NAME', 'HIGH', 'Nama identik setelah normalisasi ("BANK SYARIAH INDONESIA").'],
  WOORI: ['NORMALIZED_NAME', 'HIGH', 'Sheet BRI: "BANK WOORI SAUDARA INDONESIA 1906,TBK". Entitas sama, hanya sufiks tahun/badan hukum.'],
  MULTIARTA_SENTOSA: ['NORMALIZED_NAME', 'HIGH', 'Sheet BRI: "BANK MULTI ARTA SENTOSA". Beda spasi saja.'],
  BPD_SUMSEL_BABEL: ['NORMALIZED_NAME', 'HIGH', 'Sheet BRI: "BPD SUMSEL DAN BABEL". Baris konvensional, bukan UUS.'],
  BPD_MALUKU_MALUT: ['NORMALIZED_NAME', 'HIGH', 'Malut = Maluku Utara; sheet BRI: "BPD MALUKU DAN MALUKU UTARA".'],
  BTPN_SYARIAH: ['MANUAL_ALIAS', 'HIGH', 'BTPN = Bank Tabungan Pensiunan Nasional. Ekspansi akronim baku; hanya ada satu baris Syariah (547).'],
  BPD_JATENG: ['MANUAL_ALIAS', 'HIGH', 'Jateng = Jawa Tengah (113). Baris konvensional, bukan UUS.'],
  BPD_KALTENG: ['MANUAL_ALIAS', 'HIGH', 'Kalteng = Kalimantan Tengah (125). Tidak ada baris UUS pesaing.'],
  BPD_KALTIMTARA: ['MANUAL_ALIAS', 'HIGH', 'Kaltimtara = Kaltim dan Kaltara (124). Baris konvensional, bukan UUS.'],
  BPD_NTB_SYARIAH: ['MANUAL_ALIAS', 'HIGH', 'NTB = Nusa Tenggara Barat (128). Sheet BRI salah ketik "TENGGARAT".'],
  BPD_NAGARI: ['MANUAL_ALIAS', 'HIGH', 'Bank Nagari = BPD Sumatera Barat (118). Dipilih baris konvensional PDSBIDJ1, bukan UUS SYSBIDJ1.'],
  BJB: ['MANUAL_ALIAS', 'HIGH', 'BJB = BPD Jabar dan Banten (110). BUKAN BPD Banten (137) maupun Jabar Banten Syariah (425) — bank berbeda.'],
  BLU_BCA: ['MANUAL_ALIAS', 'HIGH', 'blu by BCA Digital = PT Bank Digital BCA (501). Bukan BCA Syariah (536).'],
  BPD_SULUTGO: ['FORMER_NAME', 'MEDIUM', 'Sheet BRI masih "BPD SULUT" (127); bank telah berganti nama menjadi Bank SulutGo. Entitas sama, nama di sheet belum diperbarui. PERLU KONFIRMASI.'],
  IBK: ['FORMER_NAME', 'MEDIUM', 'Sheet BRI menulis "PT. BANK AGRIS" (945). Bank Agris berganti nama menjadi Bank IBK Indonesia. Tidak ada kandidat pesaing, TAPI nama di sheet tidak cocok sama sekali. PERLU KONFIRMASI BRI sebelum upload live.'],
  SMBC: ['AMBIGUOUS', 'LOW', 'DICABUT (migrasi 0069). Sheet BRI memuat dua entitas grup SMBC: 45 SUNIIDJ1 "Bank Sumitomo Mitsui Indonesia" dan 213 SUNIIDJA "PT Bank SMBC Indonesia Tbk" (kode 213 = kode BTPN yang berganti nama). Katalog KESH memuat "BTPN" DAN "SMBC" terpisah, jadi maksudnya tidak bisa dipastikan. Export diblokir sampai dikonfirmasi.'],
};

const UNMAPPED_NOTE = {
  BRI: 'Tidak ada baris Bank Rakyat Indonesia di sheet "Bank Code" BRI. Transfer BRI→BRI adalah IFT (inhouse), bukan BIF — wajar di luar cakupan export ini.',
  BTPN: 'Tidak ada baris BTPN konvensional; sheet hanya memuat 547 BTPN Syariah. Kode 213 kini bernama "PT Bank SMBC Indonesia Tbk" — lihat catatan SMBC.',
  NEOBANK: 'Tidak ada di sheet "Bank Code" BRI.',
  ALLO: 'Tidak ada di sheet "Bank Code" BRI.',
  SUPERBANK: 'Tidak ada di sheet "Bank Code" BRI.',
  KROM: 'Tidak ada di sheet "Bank Code" BRI.',
  SAQU: 'Tidak ada di sheet "Bank Code" BRI.',
};

// Buang bentuk badan hukum & kata generik supaya nama bisa dibandingkan isinya.
const NOISE = /\b(PT|TBK|PERSERO|BANK|INDONESIA|UNIT|USAHA|SYARIAH|UUS|KC|NA|LTD|LIMITED|PUBLIC|CO|AG|INTERNASIONAL|INTERNATIONAL|PEMBANGUNAN|DAERAH|BPD)\b/g;
const core = (s) =>
  String(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(NOISE, ' ').replace(/\s+/g, ' ').trim();

function readKeshCatalog() {
  const src = fs.readFileSync(
    path.join(ROOT, 'src/modules/transfers/transfers.service.ts'),
    'utf8',
  );
  return [...src.matchAll(/\{ code: '([A-Z_0-9]+)',\s*name: '([^']+)' \}/g)].map((m) => ({
    code: m[1],
    name: m[2],
  }));
}

const CSV_COLUMNS = [
  'kesh_bank_code', 'kesh_bank_name', 'bri_bank_code', 'bri_bank_name',
  'bic', 'match_method', 'confidence', 'notes',
];

function toCsv(rows) {
  const esc = (v) =>
    /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  return [
    CSV_COLUMNS.join(','),
    ...rows.map((r) => CSV_COLUMNS.map((c) => esc(r[c] ?? '')).join(',')),
  ].join('\r\n');
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows: refBanks } = await pool.query(
    `SELECT bic_code, bank_code, name, kesh_bank_code FROM ref_banks`,
  );
  await pool.end();

  const byKesh = Object.fromEntries(
    refBanks.filter((r) => r.kesh_bank_code).map((r) => [r.kesh_bank_code, r]),
  );

  const counts = {};
  const out = readKeshCatalog().map((k) => {
    const m = byKesh[k.code];
    let method, confidence, notes;

    if (ADJUDICATED[k.code]) {
      [method, confidence, notes] = ADJUDICATED[k.code];
    } else if (!m) {
      [method, confidence, notes] = ['UNMAPPED', 'N/A', UNMAPPED_NOTE[k.code] ?? 'Tidak ada pemetaan.'];
    } else if (core(k.name) === core(m.name)) {
      [method, confidence, notes] = ['EXACT_NAME', 'HIGH', 'Nama badan hukum identik setelah normalisasi.'];
    } else {
      [method, confidence, notes] = ['NORMALIZED_NAME', 'MEDIUM', 'Cocok setelah normalisasi bentuk badan hukum — belum ditinjau manual.'];
    }

    // Baris yang sudah diadjudikasi tapi tidak lagi terpasang di runtime
    // (mis. SMBC) tetap dilaporkan, dengan kolom BIC dikosongkan.
    if (!m && method !== 'UNMAPPED') confidence = `${confidence} (tidak aktif)`;

    counts[method] = (counts[method] ?? 0) + 1;
    return {
      kesh_bank_code: k.code,
      kesh_bank_name: k.name,
      bri_bank_code: m ? m.bank_code : '',
      bri_bank_name: m ? m.name : '',
      bic: m ? m.bic_code : '',
      match_method: method,
      confidence,
      notes,
    };
  });

  fs.mkdirSync(path.join(ROOT, 'exports'), { recursive: true });
  const file = path.join(ROOT, 'exports/qlola-bank-bic-mapping-review.csv');
  fs.writeFileSync(file, '﻿' + toCsv(out), 'utf8'); // BOM: Excel baca UTF-8

  console.log(`wrote ${file}`);
  console.log(`total ${out.length} — ${JSON.stringify(counts)}`);
  const review = out.filter((r) => r.confidence !== 'HIGH');
  console.log(`\nperlu ditinjau manusia (${review.length}):`);
  for (const r of review) {
    console.log(`  ${r.kesh_bank_code.padEnd(18)} ${r.match_method.padEnd(16)} ${String(r.confidence).padEnd(18)} ${r.bic || '-'}`);
  }
})();
