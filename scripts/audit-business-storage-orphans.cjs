#!/usr/bin/env node
/**
 * Audit orphan storage LOCAL — HANYA BACA. Tidak pernah menghapus apa pun.
 *
 * Dibuat terpisah dari scripts/reset-business-data.cjs dengan sengaja: reset
 * bisnis hanya boleh menghapus objek yang key-nya diturunkan dari baris DB.
 * Berkas yang tidak dirujuk siapa pun BUKAN otomatis sampah — bisa saja milik
 * fitur yang belum menulis referensinya, hasil upload manual, atau artefak ops.
 * Alat ini hanya mengklasifikasi dan melaporkan supaya manusia yang memutuskan.
 *
 *   node scripts/audit-business-storage-orphans.cjs
 *   node scripts/audit-business-storage-orphans.cjs --dry-run     # sama saja
 *   node scripts/audit-business-storage-orphans.cjs --list=B      # contoh path
 *
 * Tidak ada mode --execute. Memang belum diimplementasikan.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { buildPgConfig, collectStorageKeys, localUploadRoot } = require('./reset-business-data.cjs');

const LIST_CLASS = (process.argv.find((a) => a.startsWith('--list=')) || '').split('=')[1] || null;

/**
 * Prefix operasional yang benar-benar ditulis aplikasi (uploads.service.ts,
 * data-review-drafts.service.ts, reports). Berkas di luar ini tidak dikenali
 * dan TIDAK BOLEH dianggap sampah.
 */
const KNOWN_PREFIXES = [
  { re: /^uploads\/kyc\/kyb\/\d+\/data-review\//, label: 'ADR-047 promoted document' },
  { re: /^uploads\/kyc\/kyb\//, label: 'KYC/KYB document' },
  { re: /^uploads\/_staging\/data-review\//, label: 'ADR-047 staging' },
  { re: /^uploads\/reports\//, label: 'Generated report' },
  // uploadLocal() tanpa objectKey: dokumen KYC/KYB, lampiran transfer, bukti
  // refund, dan berkas monitoring semuanya mendarat di sini.
  { re: /^uploads\/\d{4}\/\d{2}\//, label: 'Generic upload (YYYY/MM)' },
];

function classifyPrefix(key) {
  return KNOWN_PREFIXES.find((p) => p.re.test(key)) || null;
}

/** Jalan-jalan rekursif read-only. */
function walk(root, rel = '', out = []) {
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(root, childRel, out);
    else if (entry.isFile()) {
      const st = fs.statSync(path.join(root, childRel));
      out.push({ key: `uploads/${childRel}`, size: st.size, mtime: st.mtime });
    }
  }
  return out;
}

function humanBytes(n) {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function summarize(files) {
  if (!files.length) return { count: 0, bytes: 0, oldest: null, newest: null, prefixes: [] };
  const byPrefix = new Map();
  for (const f of files) {
    const label = classifyPrefix(f.key)?.label ?? f.key.split('/').slice(0, 2).join('/') + '/';
    const cur = byPrefix.get(label) || { count: 0, bytes: 0 };
    cur.count++;
    cur.bytes += f.size;
    byPrefix.set(label, cur);
  }
  const times = files.map((f) => f.mtime.getTime());
  return {
    count: files.length,
    bytes: files.reduce((a, f) => a + f.size, 0),
    oldest: new Date(Math.min(...times)),
    newest: new Date(Math.max(...times)),
    prefixes: [...byPrefix.entries()].sort((a, b) => b[1].bytes - a[1].bytes),
  };
}

const CLASS_DESC = {
  A: 'REFERENCED_BUSINESS_OBJECT      — dirujuk baris DB bisnis; dihapus oleh reset-business-data',
  B: 'KNOWN_BUSINESS_PREFIX_UNREFERENCED — prefix operasional dikenal, tapi tidak ada baris DB yang merujuk',
  C: 'UNKNOWN_OR_OTHER                — di luar prefix yang dikenal; SENGAJA TIDAK DISENTUH',
  D: 'PROTECTED / KEEP                — dirujuk data master/sistem yang dipertahankan',
};

async function main() {
  const declared = String(process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();
  const root = localUploadRoot();

  console.log('AUDIT ORPHAN STORAGE — READ ONLY (tidak ada penghapusan)');
  console.log(`  Storage backend : ${declared}`);
  console.log(`  Upload root     : ${root}`);

  if (declared !== 'LOCAL') {
    console.error(
      `\nSTORAGE_PROVIDER=${declared}. Alat ini hanya mengaudit filesystem LOCAL — ` +
        `enumerasi bucket OBS belum diimplementasikan. Tidak ada yang diaudit.`,
    );
    return;
  }
  if (!fs.existsSync(root)) {
    console.error(`\nUpload root tidak ada: ${root}. Tidak ada yang diaudit.`);
    return;
  }

  const client = new Client(buildPgConfig());
  await client.connect();
  const referenced = new Set((await collectStorageKeys(client)).keys);
  await client.end();

  const files = walk(root);

  // Kelas D: tidak ada tabel master/sistem yang menyimpan objek di UPLOAD_DIR —
  // watchlist_ingest_logs hanya menyimpan nama file, bukan objeknya. Tetap
  // dilaporkan supaya asumsinya eksplisit dan gampang direvisi.
  const classes = { A: [], B: [], C: [], D: [] };
  for (const f of files) {
    if (referenced.has(f.key)) classes.A.push(f);
    else if (classifyPrefix(f.key)) classes.B.push(f);
    else classes.C.push(f);
  }

  const total = summarize(files);
  console.log(`\n  Total berkas    : ${total.count} (${humanBytes(total.bytes)})`);
  console.log(`  Key dirujuk DB  : ${referenced.size}`);

  for (const cls of ['A', 'B', 'C', 'D']) {
    const s = summarize(classes[cls]);
    console.log(`\n${cls}. ${CLASS_DESC[cls]}`);
    console.log(`   berkas    : ${s.count}`);
    console.log(`   ukuran    : ${humanBytes(s.bytes)}`);
    console.log(`   modifikasi: ${s.oldest ? `${s.oldest.toISOString().slice(0, 10)} .. ${s.newest.toISOString().slice(0, 10)}` : '-'}`);
    if (s.prefixes.length) {
      console.log('   prefix    :');
      for (const [label, v] of s.prefixes) console.log(`     - ${label.padEnd(36)} ${String(v.count).padStart(7)} berkas  ${humanBytes(v.bytes).padStart(10)}`);
    }
    if (LIST_CLASS === cls) {
      console.log('   contoh path:');
      for (const f of classes[cls].slice(0, 25)) console.log(`     ${f.key}`);
      if (classes[cls].length > 25) console.log(`     ... dan ${classes[cls].length - 25} lainnya`);
    }
  }

  console.log(`
CATATAN
  - Kelas A dihapus oleh scripts/reset-business-data.cjs (key dari baris DB).
  - Kelas B TIDAK dihapus alat mana pun saat ini. Berkas tak-dirujuk belum tentu
    sampah — bisa upload yang barisnya gagal tersimpan, atau berkas yang
    referensinya berbentuk URL host lain. Perlu keputusan manual.
  - Kelas C sengaja dibiarkan utuh. Jangan hapus tanpa audit tersendiri.
  - Sampah staging ADR-047 punya alat sendiri yang lebih aman:
    node scripts/cleanup-data-review-objects.cjs
  - Alat ini tidak punya mode --execute. Memang belum diimplementasikan.`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = { KNOWN_PREFIXES, classifyPrefix, summarize, humanBytes };
