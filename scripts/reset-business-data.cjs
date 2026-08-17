#!/usr/bin/env node
/**
 * Reset data bisnis/operasional hasil sanity — SEKALI PAKAI sebelum go-live.
 *
 * INI BUKAN MIGRASI dan BUKAN reset database. Skema, master data, referensi
 * wilayah, bank, watchlist master, users/roles, dan schema_migrations TIDAK
 * disentuh. Yang dihapus hanya tabel yang ada di DELETE_ORDER (allowlist
 * eksplisit) — tidak ada logika "hapus semua kecuali X".
 *
 *   node scripts/reset-business-data.cjs                # dry-run (default)
 *   node scripts/reset-business-data.cjs --dry-run
 *   node scripts/reset-business-data.cjs --verify
 *   node scripts/reset-business-data.cjs --execute --backup-confirmed
 *   node scripts/reset-business-data.cjs --storage-retry
 *
 * Lihat docs/ops/business-data-reset.md.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Client } = require('pg');

const CONFIRM_PHRASE = 'RESET-KESH-BUSINESS-DATA';
const MANIFEST_PATH = path.join(__dirname, '..', '.reset-storage-manifest.json');

// ---------------------------------------------------------------------------
// Klasifikasi — hasil audit skema (lihat docs/ops/business-data-reset.md).
// Urutan DELETE_ORDER mengikuti dependensi FK sebenarnya: anak sebelum induk.
// Sengaja DELETE eksplisit, bukan TRUNCATE CASCADE, supaya tidak ada tabel di
// luar allowlist yang ikut terhapus lewat cascade.
// ---------------------------------------------------------------------------
const DELETE_ORDER = [
  // SATU-SATUNYA pengecualian dari strategi DELETE. Alasannya (diaudit ulang
  // sebelum go-live, lihat docs/ops/business-data-reset.md §2a):
  //   - tidak ada FK masuk ke notifications sama sekali (katalog dicek), jadi
  //     TRUNCATE tanpa CASCADE tidak akan pernah menyentuh tabel lain;
  //   - tidak ada template/konfigurasi di tabel ini — skema 0066 hanya baris
  //     instance per-penerima, `object_type`/`object_id` NOT NULL dan seluruh
  //     nilainya menunjuk entitas bisnis yang ikut dihapus;
  //   - migrasi 0066 menyatakan tabel ini "convenience layer" di atas layar
  //     worklist yang tetap jadi source of truth — tidak ada kewajiban retensi;
  //   - volumenya (8jt+ baris) membuat DELETE massal menghasilkan WAL dan dead
  //     tuple yang tidak perlu.
  // TANPA CASCADE, TANPA RESTART IDENTITY, tetap di dalam transaksi yang sama.
  { table: 'notifications', strategy: 'TRUNCATE' },
  // Audit log HANYA untuk object_type yang entitasnya ikut terhapus.
  // Baris administratif (USER, dan object_type baru apa pun) dipertahankan.
  { table: 'audit_logs', where: "object_type IN ('APPLICATION','TRANSFER','MONITORING_CASE')" },
  { table: 'generated_reports' },

  // Monitoring (LTKT/LTKM) — turunan dari transfer/aplikasi.
  { table: 'monitoring_case_triggers' },
  { table: 'monitoring_cases' },

  // Pengaduan & refund.
  { table: 'statement_refunds' },
  { table: 'complaints' },

  // Transfer.
  { table: 'transfer_watchlist_hits' },
  { table: 'transfer_compliance_reviews' },
  { table: 'transfers' },
  { table: 'transfer_batches' },

  // Pengkinian Data (ADR-047).
  { table: 'application_data_review_changes' },
  { table: 'application_data_reviews' },

  // Turunan aplikasi KYC/KYB.
  { table: 'documents' },
  { table: 'application_edd' },
  { table: 'application_risk' },
  { table: 'risk_profiles' },
  // Hasil screening (bukan master watchlist — master ada di watchlist_entries).
  { table: 'screening_results' },

  { table: 'applications' },

  // Pihak badan usaha, lalu badan usaha, lalu persons.
  { table: 'authorized_representatives' },
  { table: 'business_roles' },
  { table: 'business_parties' },
  { table: 'business_entities' },
  // persons hanya dihapus kalau sudah tidak dirujuk siapa pun. Setelah 4 tabel
  // di atas kosong, syarat ini otomatis terpenuhi untuk seluruh baris; guard
  // NOT EXISTS-nya tetap dipasang supaya skema baru yang merujuk persons
  // membuat baris terkait selamat, bukan terhapus diam-diam.
  {
    table: 'persons',
    // countWhere=null: saat dilaporkan/diverifikasi, hitung SELURUH tabel.
    // Guard NOT EXISTS di bawah dievaluasi SETELAH 4 tabel perujuk kosong,
    // jadi memakainya untuk menghitung di dry-run akan sangat under-report.
    countWhere: null,
    where: `NOT EXISTS (SELECT 1 FROM applications a WHERE a.person_id = persons.id)
        AND NOT EXISTS (SELECT 1 FROM business_parties bp WHERE bp.person_id = persons.id)
        AND NOT EXISTS (SELECT 1 FROM authorized_representatives ar WHERE ar.person_id = persons.id)
        AND NOT EXISTS (SELECT 1 FROM business_roles br WHERE br.person_id = persons.id)`,
  },
];

/** Tabel yang WAJIB tetap berisi setelah reset (dicek di --verify). */
const MASTER_KEEP = [
  'users',
  'roles',
  'branches',
  'ref_provinces',
  'ref_regencies',
  'ref_districts',
  'ref_villages',
  'ref_banks',
  'watchlist_entries',
  'schema_migrations',
];

/** Dipertahankan, tapi boleh kosong — jadi tidak masuk assert --verify. */
const MASTER_KEEP_MAY_BE_EMPTY = ['watchlist_sources', 'watchlist_ingest_logs'];

/**
 * Tidak dihapus otomatis. Alasan didokumentasikan supaya keputusan ini eksplisit.
 */
const NEEDS_REVIEW = {
  jobs: 'Tabel job runner generik (job_type/summary_json), saat ini 0 baris dan tidak ada ' +
    'penulis di src/. Tidak jelas operasional atau sistem — dibiarkan.',
  'audit_logs (object_type di luar APPLICATION/TRANSFER/MONITORING_CASE)':
    'Baris USER_* adalah audit administratif atas akun yang dipertahankan, jadi ikut dipertahankan.',
  watchlist_ingest_logs:
    'Riwayat impor master DTTOT/PPPSPM — jejak sistem atas master data, bukan data nasabah.',
};

/** Kolom yang menyimpan objek storage. Dipanen sebelum DB dihapus. */
const STORAGE_SOURCES = [
  { label: 'KYC/KYB documents', sql: 'SELECT file_uri AS uri FROM documents WHERE file_uri IS NOT NULL' },
  {
    label: 'KYC/KYB document object_key',
    sql: "SELECT extracted_json->>'object_key' AS uri FROM documents WHERE extracted_json ? 'object_key'",
  },
  {
    label: 'Data-review staging (ADR-047)',
    sql: 'SELECT staged_object_key AS uri FROM application_data_review_changes WHERE staged_object_key IS NOT NULL',
  },
  { label: 'Generated reports', sql: 'SELECT object_key AS uri FROM generated_reports WHERE object_key IS NOT NULL' },
  { label: 'Transfer attachments', sql: 'SELECT attachment_uri AS uri FROM transfers WHERE attachment_uri IS NOT NULL' },
  {
    label: 'Transfer result attachments',
    sql: 'SELECT result_attachment_uri AS uri FROM transfers WHERE result_attachment_uri IS NOT NULL',
  },
  {
    label: 'Refund evidence',
    sql: 'SELECT evidence_uri AS uri FROM statement_refunds WHERE evidence_uri IS NOT NULL',
  },
  {
    label: 'Monitoring report files',
    sql: 'SELECT report_file_uri AS uri FROM monitoring_cases WHERE report_file_uri IS NOT NULL',
  },
];

// ---------------------------------------------------------------------------
// Helper murni (diuji di scripts/reset-business-data.test.cjs)
// ---------------------------------------------------------------------------

/** Sama dengan scripts/run-sql.cjs: DATABASE_URL menang, kalau kosong pakai PG*. */
function buildPgConfig(env = process.env) {
  const url = env.DATABASE_URL;
  if (url && url.trim()) return { connectionString: url.trim() };
  return {
    host: env.PGHOST || 'localhost',
    port: Number(env.PGPORT || 5432),
    user: env.PGUSER || 'postgres',
    password: env.PGPASSWORD,
    database: env.PGDATABASE || 'kesh-internal-local',
  };
}

/** Deskripsi target koneksi TANPA password. Dipakai di banner konfirmasi. */
function describeTarget(env = process.env) {
  const cfg = buildPgConfig(env);
  if (cfg.connectionString) {
    // URL diurai manual supaya password tidak pernah ikut ter-print.
    const m = cfg.connectionString.match(/^\w+:\/\/(?:([^:@/]+)(?::[^@/]*)?@)?([^:/?]+)(?::(\d+))?\/([^?]+)/);
    if (m) return { host: m[2], port: m[3] || '5432', database: m[4], user: m[1] || '(unknown)' };
    return { host: '(unparsed)', port: '?', database: '(unparsed)', user: '(unknown)' };
  }
  return { host: cfg.host, port: String(cfg.port), database: cfg.database, user: cfg.user };
}

/**
 * Ubah file_uri/object_key jadi key storage yang boleh dihapus.
 * Hanya key ber-prefix `uploads/` yang dianggap milik kita (berlaku untuk LOCAL
 * maupun OBS — keduanya memakai prefix itu). URL host asing (mis. fixture
 * https://storage.test/...) mengembalikan null dan tidak pernah dihapus.
 */
function toObjectKey(uri) {
  if (typeof uri !== 'string') return null;
  let s = uri.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    let pathname;
    try {
      pathname = new URL(s).pathname;
    } catch {
      return null;
    }
    s = decodeURIComponent(pathname);
    s = s.replace(/^\/+/, '').replace(/^api\//, '');
  }
  s = s.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s.startsWith('uploads/')) return null;
  if (s.split('/').includes('..')) return null;
  return s;
}

function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const mode = has('--verify')
    ? 'verify'
    : has('--storage-retry')
      ? 'storage-retry'
      : has('--execute')
        ? 'execute'
        : 'dry-run';
  return {
    mode,
    backupConfirmed: has('--backup-confirmed'),
    resetSequences: has('--reset-sequences'),
    nonInteractiveOk: has('--yes-i-am-sure'),
  };
}

/**
 * Semua syarat eksekusi destruktif. Mengembalikan daftar alasan penolakan —
 * kosong berarti boleh lanjut ke konfirmasi interaktif.
 */
function checkExecuteGuards(args, env, isTty) {
  const blockers = [];
  if (String(env.ALLOW_BUSINESS_DATA_RESET).toLowerCase() !== 'true') {
    blockers.push('ALLOW_BUSINESS_DATA_RESET=true belum diset di environment.');
  }
  if (!args.backupConfirmed) {
    blockers.push('--backup-confirmed tidak diberikan (backup/snapshot DB wajib lebih dulu).');
  }
  if (!isTty && !args.nonInteractiveOk) {
    blockers.push(
      'Berjalan non-interaktif tanpa --yes-i-am-sure — konfirmasi ketik-frasa tidak bisa dilewati diam-diam.',
    );
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Hitung baris. countWhere (kalau ada) menang atas where — lihat spec persons. */
async function countRows(client, spec) {
  const where = 'countWhere' in spec ? spec.countWhere : spec.where;
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${spec.table}${where ? ` WHERE ${where}` : ''}`);
  return rows[0].n;
}

/** Panen key storage dari DB. Dipanggil SEBELUM transaksi hapus. */
async function collectStorageKeys(client) {
  const groups = [];
  const all = new Set();
  const skipped = new Set();
  for (const src of STORAGE_SOURCES) {
    const { rows } = await client.query(src.sql);
    const keys = [];
    for (const r of rows) {
      const key = toObjectKey(r.uri);
      if (key) {
        keys.push(key);
        all.add(key);
      } else if (r.uri) {
        skipped.add(String(r.uri));
      }
    }
    groups.push({ label: src.label, total: rows.length, keys: [...new Set(keys)] });
  }
  return { groups, keys: [...all], skipped: [...skipped] };
}

function pad(label, value) {
  return `  ${String(label).padEnd(46)}${String(value).padStart(10)}`;
}

async function printBanner(client, args) {
  const t = describeTarget();
  console.log('KESH BUSINESS DATA RESET');
  console.log(`  mode                : ${args.mode.toUpperCase()}`);
  console.log(`  DATABASE HOST       : ${t.host}:${t.port}`);
  console.log(`  DATABASE NAME       : ${t.database}`);
  console.log(`  DATABASE USER       : ${t.user}`);
  console.log(`  NODE_ENV / APP_ENV  : ${process.env.NODE_ENV || '(unset)'} / ${process.env.APP_ENV || '(unset)'}`);
  console.log(`  STORAGE BACKEND     : ${(process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase()}`);
  const declared = (process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();
  console.log(
    `  ${declared === 'HUAWEI_OBS' ? 'OBS BUCKET          ' : 'UPLOAD ROOT         '}: ${
      declared === 'HUAWEI_OBS' ? process.env.OBS_BUCKET_NAME || '(unset)' : localUploadRoot()
    }`,
  );
  console.log('');
}

async function report(client, args) {
  const business = [];
  for (const spec of DELETE_ORDER) {
    const filtered = spec.where && !('countWhere' in spec);
    const tag = spec.strategy === 'TRUNCATE' ? ' (TRUNCATE)' : filtered ? ' (terfilter)' : '';
    business.push([spec.table + tag, await countRows(client, spec)]);
  }

  const storage = await collectStorageKeys(client);

  console.log('BUSINESS DATA (akan dihapus)');
  for (const [label, n] of business) console.log(pad(label, n));
  console.log(pad('TOTAL baris', business.reduce((a, b) => a + b[1], 0)));

  console.log('\nSTORAGE (objek yang akan dihapus setelah DB commit)');
  for (const g of storage.groups) console.log(pad(g.label, g.keys.length));
  console.log(pad('TOTAL objek unik', storage.keys.length));

  // Diperiksa sejak dry-run supaya ketidakcocokan backend ketahuan SEBELUM
  // eksekusi, bukan setelah baris DB-nya hilang.
  if (String(process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase() === 'LOCAL') {
    const { present, unresolved } = splitLocalResolvable(storage.keys);
    console.log(pad('  ada di backend aktif (LOCAL)', present.length));
    console.log(pad('  UNRESOLVED_OBJECT', unresolved.length));
    if (unresolved.length) {
      console.log(`      ${unresolved.length} key DB tidak ada di ${localUploadRoot()} —`);
      console.log('      tidak akan diklaim terhapus. Periksa apakah ditulis backend storage lain.');
    }
  }

  if (storage.skipped.length) {
    console.log(`\n  ${storage.skipped.length} URI di luar prefix "uploads/" DILEWATI (bukan objek kelolaan kita), contoh:`);
    for (const s of storage.skipped.slice(0, 3)) console.log(`    - ${s}`);
  }

  console.log('\nWILL KEEP (master / auth / referensi)');
  for (const t of [...MASTER_KEEP, ...MASTER_KEEP_MAY_BE_EMPTY]) console.log(pad(t, await countRows(client, { table: t })));
  console.log(pad('konfigurasi RBA', 'di kode (rba-v01.engine.ts), tanpa tabel'));

  console.log('\nNEEDS REVIEW (tidak dihapus otomatis)');
  for (const [t, why] of Object.entries(NEEDS_REVIEW)) {
    console.log(`  ${t}`);
    console.log(`      ${why}`);
  }
  return storage;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Pakai adapter storage aplikasi supaya LOCAL & OBS sama-sama tertangani. */
function loadUploads() {
  const { UploadsService } = require('../dist/modules/uploads/uploads.service');
  const uploads = new UploadsService();
  uploads.onModuleInit();
  return uploads;
}

/**
 * Backend yang dideklarasikan vs yang benar-benar aktif.
 * UploadsService DIAM-DIAM fallback ke LOCAL kalau STORAGE_PROVIDER=HUAWEI_OBS
 * tapi env OBS tidak lengkap. Kalau itu terjadi, menghapus berarti menghapus
 * berkas LOCAL padahal objek sebenarnya ada di OBS — jadi jangan hapus apa pun.
 */
function checkStorageBackend(uploads, env = process.env) {
  const declared = String(env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();
  const effective = uploads.isObs() ? 'HUAWEI_OBS' : 'LOCAL';
  return { declared, effective, mismatch: declared !== effective };
}

/** Root LOCAL yang sudah di-resolve — dicetak sebelum konfirmasi. */
function localUploadRoot(env = process.env) {
  return path.resolve(process.cwd(), env.UPLOAD_DIR || 'uploads');
}

/**
 * Pisahkan key yang benar-benar ada di backend LOCAL dari yang tidak.
 * deleteLocal() menelan ENOENT, jadi tanpa pemisahan ini key milik backend lain
 * akan terhitung "berhasil dihapus" padahal tidak pernah ada — persis kegagalan
 * senyap yang harus dihindari.
 */
function splitLocalResolvable(keys, env = process.env) {
  const root = localUploadRoot(env);
  const present = [];
  const unresolved = [];
  for (const key of keys) {
    const rel = key.replace(/^uploads\//, '');
    (fs.existsSync(path.join(root, ...rel.split('/'))) ? present : unresolved).push(key);
  }
  return { present, unresolved };
}

async function deleteObjects(keys) {
  if (!keys.length) return { ok: 0, failed: [], unresolved: [], mismatch: null };
  let uploads;
  try {
    uploads = loadUploads();
  } catch (e) {
    console.error(`\n!! Adapter storage tidak bisa dimuat (${e.message}). Jalankan "npm run build" lalu --storage-retry.`);
    return { ok: 0, failed: keys.slice(), unresolved: [], mismatch: null };
  }

  const backend = checkStorageBackend(uploads);
  console.log(`  Storage backend: ${backend.effective}`);
  if (backend.effective === 'LOCAL') console.log(`  Upload root    : ${localUploadRoot()}`);
  else console.log(`  OBS bucket     : ${process.env.OBS_BUCKET_NAME}`);

  if (backend.mismatch) {
    console.error(
      `\n!! STORAGE_BACKEND_MISMATCH — STORAGE_PROVIDER=${backend.declared} tapi adapter aktif ` +
        `${backend.effective} (env OBS tidak lengkap). TIDAK ADA objek yang dihapus: menghapus di ` +
        `backend yang salah akan menghancurkan berkas yang tidak dimaksud.`,
    );
    return { ok: 0, failed: [], unresolved: keys.slice(), mismatch: backend };
  }

  // Di LOCAL, key yang berkasnya tidak ada tidak pernah diklaim terhapus.
  let targets = keys;
  let unresolved = [];
  if (backend.effective === 'LOCAL') {
    const split = splitLocalResolvable(keys);
    targets = split.present;
    unresolved = split.unresolved;
  }

  let ok = 0;
  const failed = [];
  for (const key of targets) {
    try {
      await uploads.deleteObject(key);
      ok++;
    } catch (e) {
      console.error(`  gagal hapus ${key}: ${e.message}`);
      failed.push(key);
    }
  }
  return { ok, failed, unresolved, mismatch: null };
}

function writeManifest(keys, unresolved = []) {
  fs.writeFileSync(
    MANIFEST_PATH,
    JSON.stringify({ writtenAt: new Date().toISOString(), keys, unresolved }, null, 2),
  );
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

async function runDryRun(client, args) {
  await printBanner(client, args);
  await report(client, args);
  console.log('\nDRY RUN — tidak ada data yang dihapus.');
  console.log(`Untuk eksekusi: ALLOW_BUSINESS_DATA_RESET=true node scripts/reset-business-data.cjs --execute --backup-confirmed`);
}

async function confirmInteractive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(`\nKetik persis "${CONFIRM_PHRASE}" untuk lanjut: `, res));
  rl.close();
  return answer.trim() === CONFIRM_PHRASE;
}

async function runExecute(client, args) {
  await printBanner(client, args);

  const blockers = checkExecuteGuards(args, process.env, Boolean(process.stdin.isTTY));
  if (blockers.length) {
    console.error('EKSEKUSI DITOLAK:');
    for (const b of blockers) console.error(`  - ${b}`);
    process.exitCode = 1;
    return;
  }

  const storage = await report(client, args);

  if (process.stdin.isTTY && !(await confirmInteractive())) {
    console.error('\nKonfirmasi tidak cocok — dibatalkan. Tidak ada yang dihapus.');
    process.exitCode = 1;
    return;
  }

  // FASE 1 — manifest ditulis lebih dulu supaya storage tetap bisa diulang
  // walaupun proses mati setelah DB commit.
  writeManifest(storage.keys);
  console.log(`\nManifest storage ditulis: ${MANIFEST_PATH} (${storage.keys.length} objek)`);

  // FASE 2 — satu transaksi untuk seluruh DB.
  console.log('\nFASE 2 — hapus database (satu transaksi)');
  await client.query('BEGIN');
  try {
    for (const spec of DELETE_ORDER) {
      if (spec.strategy === 'TRUNCATE') {
        // rowCount TRUNCATE selalu null, jadi dihitung dulu supaya log jujur.
        const before = await countRows(client, spec);
        await client.query(`TRUNCATE TABLE ${spec.table}`);
        console.log(pad(`${spec.table} (TRUNCATE)`, `-${before}`));
        continue;
      }
      const sql = `DELETE FROM ${spec.table}${spec.where ? ` WHERE ${spec.where}` : ''}`;
      const res = await client.query(sql);
      console.log(pad(spec.table, `-${res.rowCount}`));
    }
    if (args.resetSequences) {
      for (const spec of DELETE_ORDER) {
        const { rows } = await client.query(`SELECT pg_get_serial_sequence($1, 'id') AS seq`, [spec.table]);
        if (rows[0].seq) {
          await client.query(`SELECT setval($1, 1, false)`, [rows[0].seq]);
          console.log(pad(`  sequence ${rows[0].seq}`, 'reset'));
        }
      }
    }
    await client.query('COMMIT');
    console.log('  COMMIT ok');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`\nGAGAL — ROLLBACK dilakukan, database tidak berubah: ${e.message}`);
    console.error('Objek storage TIDAK disentuh.');
    process.exitCode = 1;
    return;
  }

  // FASE 3 — storage hanya setelah DB commit sukses.
  console.log('\nFASE 3 — hapus objek storage');
  const { ok, failed, unresolved, mismatch } = await deleteObjects(storage.keys);
  console.log(`  dihapus ${ok}, gagal ${failed.length}, tidak terselesaikan ${unresolved.length}`);

  if (mismatch) {
    writeManifest(storage.keys, unresolved);
    console.error(
      `\nRESET DB SELESAI, STORAGE TIDAK DIPROSES — perbaiki konfigurasi storage lalu jalankan ` +
        `node scripts/reset-business-data.cjs --storage-retry`,
    );
    process.exitCode = 1;
    return;
  }
  if (failed.length || unresolved.length) {
    writeManifest(failed, unresolved);
    if (failed.length) {
      console.error(`\nRESET SELESAI SEBAGIAN — ${failed.length} objek gagal dihapus:`);
      for (const k of failed.slice(0, 20)) console.error(`  - ${k}`);
      if (failed.length > 20) console.error(`  ... dan ${failed.length - 20} lainnya (semuanya ada di manifest)`);
      console.error(`Ulangi dengan: node scripts/reset-business-data.cjs --storage-retry`);
      process.exitCode = 1;
    }
    if (unresolved.length) {
      console.error(
        `\n!! UNRESOLVED_OBJECT — ${unresolved.length} key dari DB tidak ada di backend aktif ` +
          `(${(process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase()}). Ini TIDAK dihitung sebagai terhapus. ` +
          `Kemungkinan besar ditulis oleh backend storage lain; periksa sebelum menganggap reset tuntas:`,
      );
      for (const k of unresolved.slice(0, 10)) console.error(`  - ${k}`);
      if (unresolved.length > 10) console.error(`  ... dan ${unresolved.length - 10} lainnya (semuanya ada di manifest)`);
    }
    return;
  }

  fs.unlinkSync(MANIFEST_PATH);
  console.log('\nRESET SELESAI. Jalankan --verify, lalu ikuti checklist di docs/ops/business-data-reset.md.');
  // notifications di-TRUNCATE (tidak meninggalkan dead tuple), jadi tidak masuk daftar.
  console.log('Saran: VACUUM ANALYZE pada tabel yang dihapus massal — audit_logs, transfers, documents.');
}

async function runStorageRetry() {
  const manifest = readManifest();
  if (!manifest) {
    console.log(`Tidak ada manifest di ${MANIFEST_PATH} — tidak ada yang perlu diulang.`);
    return;
  }
  // unresolved dari run sebelumnya ikut dicoba lagi — backend mungkin sudah benar.
  const pending = [...new Set([...(manifest.keys || []), ...(manifest.unresolved || [])])];
  console.log(`Mengulang hapus ${pending.length} objek dari manifest ${manifest.writtenAt}`);
  const { ok, failed, unresolved, mismatch } = await deleteObjects(pending);
  console.log(`  dihapus ${ok}, gagal ${failed.length}, tidak terselesaikan ${unresolved.length}`);
  if (mismatch || failed.length || unresolved.length) {
    writeManifest(mismatch ? pending : failed, mismatch ? [] : unresolved);
    process.exitCode = 1;
    return;
  }
  fs.unlinkSync(MANIFEST_PATH);
  console.log('Semua objek bersih.');
}

const CHECKLIST = `
CHECKLIST MANUAL PASCA-RESET (jalankan sendiri, skrip ini tidak membuat data uji):
  [ ] login SystemAdmin
  [ ] login FrontDesk
  [ ] buat Our Customer (INDIVIDUAL)
  [ ] buat WIC
  [ ] buat Business KYB
  [ ] submit + approve KYC
  [ ] buat transfer
  [ ] alur approval transfer (supervisor -> finance -> approve)
  [ ] finalisasi hasil provider
  [ ] resi / receipt
  [ ] akses report`;

async function runVerify(client, args) {
  await printBanner(client, args);
  const results = [];
  // level 'warn' dicetak menonjol tapi tidak menggagalkan verifikasi.
  const check = (name, pass, detail = '', level = 'fail') => results.push({ name, pass, detail, level });

  for (const spec of DELETE_ORDER) {
    const n = await countRows(client, spec);
    const filtered = spec.where && !('countWhere' in spec);
    check(`kosong: ${spec.table}${filtered ? ' (terfilter)' : ''}`, n === 0, `${n} baris tersisa`);
  }

  // Orphan: baris bisnis yang menunjuk induk yang sudah hilang.
  const orphans = [
    ['application_risk -> applications', 'SELECT count(*)::int n FROM application_risk r LEFT JOIN applications a ON a.id=r.application_id WHERE a.id IS NULL'],
    ['screening_results -> applications', 'SELECT count(*)::int n FROM screening_results s LEFT JOIN applications a ON a.id=s.application_id WHERE a.id IS NULL'],
    ['transfers -> applications', 'SELECT count(*)::int n FROM transfers t LEFT JOIN applications a ON a.id=t.sender_application_id WHERE t.sender_application_id IS NOT NULL AND a.id IS NULL'],
    ['business_parties -> persons', 'SELECT count(*)::int n FROM business_parties bp LEFT JOIN persons p ON p.id=bp.person_id WHERE p.id IS NULL'],
  ];
  for (const [name, sql] of orphans) {
    const { rows } = await client.query(sql);
    check(`tanpa orphan: ${name}`, rows[0].n === 0, `${rows[0].n} orphan`);
  }

  for (const t of MASTER_KEEP) {
    const n = await countRows(client, { table: t });
    check(`master tetap ada: ${t}`, n > 0, `${n} baris`);
  }

  const admin = await client.query("SELECT count(*)::int n FROM users WHERE role='SystemAdmin' AND is_active");
  check('admin aktif masih ada', admin.rows[0].n > 0, `${admin.rows[0].n} SystemAdmin aktif`);

  const migFiles = fs
    .readdirSync(path.join(__dirname, '..', 'infra', 'db', 'migrations'))
    .filter((f) => f.endsWith('.sql')).length;
  const migRows = await countRows(client, { table: 'schema_migrations' });
  check('schema_migrations utuh', migRows === migFiles, `${migRows} baris vs ${migFiles} file migrasi`);

  const keptAudit = await client.query(
    "SELECT count(*)::int n FROM audit_logs WHERE object_type NOT IN ('APPLICATION','TRANSFER','MONITORING_CASE')",
  );
  check('audit administratif dipertahankan', true, `${keptAudit.rows[0].n} baris non-bisnis tersisa (informasional)`);

  // Backend storage aktif harus sama dengan yang dideklarasikan, kalau tidak
  // penghapusan storage berjalan di tempat yang salah (atau tidak berjalan).
  try {
    const backend = checkStorageBackend(loadUploads());
    check(
      `storage backend konsisten (${backend.effective})`,
      !backend.mismatch,
      backend.mismatch ? `STORAGE_BACKEND_MISMATCH: dideklarasikan ${backend.declared}` : localUploadRoot(),
    );
  } catch (e) {
    check('storage backend konsisten', true, `tidak dicek (${e.message})`, 'warn');
  }

  // Manifest yang tersisa berarti masih ada objek yang belum tuntas.
  const manifest = readManifest();
  const pendingKeys = manifest ? (manifest.keys || []).length : 0;
  const pendingUnresolved = manifest ? (manifest.unresolved || []).length : 0;
  check(
    'storage bersih (tidak ada objek tertunda)',
    pendingKeys === 0,
    pendingKeys ? `${pendingKeys} objek belum terhapus — jalankan --storage-retry` : 'tidak ada sisa',
  );
  if (pendingUnresolved) {
    check(
      'UNRESOLVED_OBJECT',
      false,
      `${pendingUnresolved} key DB tidak ditemukan di backend aktif — kemungkinan ditulis backend storage lain`,
      'warn',
    );
  }

  console.log('HASIL VERIFIKASI');
  let failed = 0;
  for (const r of results) {
    const tag = r.pass ? 'PASS' : r.level === 'warn' ? 'WARN' : 'FAIL';
    if (!r.pass && r.level !== 'warn') failed++;
    console.log(`  [${tag}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n${failed === 0 ? 'SEMUA CHECK PASS' : `${failed} CHECK GAGAL`}`);
  console.log('Catatan: konfigurasi RBA ada di kode (src/.../rba-v01.engine.ts), tidak ada tabel untuk dicek.');
  if (failed === 0) console.log(CHECKLIST);
  else process.exitCode = 1;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'storage-retry') return runStorageRetry();

  const client = new Client(buildPgConfig());
  await client.connect();
  try {
    if (args.mode === 'verify') await runVerify(client, args);
    else if (args.mode === 'execute') await runExecute(client, args);
    else await runDryRun(client, args);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('Fatal:', e.message);
    process.exit(1);
  });
}

module.exports = {
  CONFIRM_PHRASE,
  DELETE_ORDER,
  MASTER_KEEP,
  MASTER_KEEP_MAY_BE_EMPTY,
  NEEDS_REVIEW,
  STORAGE_SOURCES,
  buildPgConfig,
  describeTarget,
  toObjectKey,
  parseArgs,
  checkExecuteGuards,
  checkStorageBackend,
  collectStorageKeys,
  localUploadRoot,
  splitLocalResolvable,
};
