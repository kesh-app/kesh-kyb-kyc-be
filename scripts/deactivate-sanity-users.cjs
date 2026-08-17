#!/usr/bin/env node
/**
 * Nonaktifkan akun test/sanity sebelum go-live — SOFT, tidak pernah menghapus.
 *
 * Hanya menyentuh satu kolom: users.is_active. Tidak menghapus baris, tidak
 * mengubah email/password/role, tidak menyentuh roles, audit_logs, atau data
 * bisnis apa pun. Terpisah total dari scripts/reset-business-data.cjs.
 *
 *   node scripts/deactivate-sanity-users.cjs               # dry-run (default)
 *   node scripts/deactivate-sanity-users.cjs --dry-run
 *   node scripts/deactivate-sanity-users.cjs --verify
 *   ALLOW_SANITY_USER_DEACTIVATION=true \
 *     node scripts/deactivate-sanity-users.cjs --execute --backup-confirmed
 *
 * Bergantung pada penegakan is_active di jalur login (src/modules/auth/
 * auth.service.ts). Tanpa itu, menonaktifkan akun tidak menghalangi apa pun.
 */

require('dotenv').config();
const readline = require('readline');
const { Client } = require('pg');
const { buildPgConfig, describeTarget } = require('./reset-business-data.cjs');

const CONFIRM_PHRASE = 'DEACTIVATE-KESH-SANITY-USERS';

/** Domain fixture E2E/sanity — satu-satunya sumber kandidat. */
const SANITY_EMAIL_LIKE = '%@test.local';

/**
 * Akun bawaan scripts/seed.cjs. Dipakai sebagai assertion, bukan sebagai
 * sumber daftar preserved: himpunan preserved diturunkan dari DB (semua akun
 * non-sanity), jadi akun internal yang dibuat manual ikut terlindungi tanpa
 * perlu didaftarkan di sini.
 */
const SEED_EMAILS = [
  'admin@example.com',
  'sysadmin@kesh.local',
  'operation.supervisor@kesh.co.id',
  'director@kesh.co.id',
];

/**
 * Role yang tidak pernah dinonaktifkan otomatis walaupun email-nya sanity.
 * SystemAdmin adalah satu-satunya jalan masuk manajemen user; kalau ada akun
 * SystemAdmin bernuansa sanity, itu keputusan manusia, bukan skrip.
 */
const NEVER_DEACTIVATE_ROLES = ['SystemAdmin'];

// ---------------------------------------------------------------------------
// Seleksi
// ---------------------------------------------------------------------------

/**
 * Klasifikasi seluruh baris users. Tidak pernah mengandalkan pola email saja:
 * kandidat wajib lolos semua syarat, dan apa pun yang tidak lolos dilaporkan
 * sebagai UNCLASSIFIED, bukan diam-diam dilewati atau diam-diam ikut.
 */
async function classifyUsers(client) {
  const { rows: roleRows } = await client.query('SELECT name FROM roles');
  const knownRoles = new Set(roleRows.map((r) => r.name));

  const { rows: users } = await client.query(
    `SELECT id, email, role, is_active, email LIKE $1 AS is_sanity
       FROM users ORDER BY id`,
    [SANITY_EMAIL_LIKE],
  );

  const candidates = [];
  const preserved = [];
  const unclassified = [];
  const alreadyInactive = [];

  for (const u of users) {
    if (!u.is_sanity) {
      preserved.push(u);
      continue;
    }
    // Mulai sini: email sanity. Wajib lolos sisa syaratnya.
    if (!knownRoles.has(u.role)) {
      unclassified.push({ ...u, reason: `role "${u.role}" tidak ada di master roles` });
      continue;
    }
    if (NEVER_DEACTIVATE_ROLES.includes(u.role)) {
      unclassified.push({ ...u, reason: `role ${u.role} tidak pernah dinonaktifkan otomatis` });
      continue;
    }
    if (!u.is_active) {
      alreadyInactive.push(u);
      continue;
    }
    candidates.push(u);
  }

  const activeAdminsBefore = users.filter((u) => u.role === 'SystemAdmin' && u.is_active);
  const candidateIds = new Set(candidates.map((u) => u.id));
  const activeAdminsAfter = activeAdminsBefore.filter((u) => !candidateIds.has(u.id));

  return { users, candidates, preserved, unclassified, alreadyInactive, activeAdminsBefore, activeAdminsAfter };
}

/** Invarian yang harus dipenuhi sebelum eksekusi apa pun. */
function checkInvariants(cls) {
  const blockers = [];
  if (cls.activeAdminsAfter.length < 1) {
    blockers.push('Tidak ada SystemAdmin aktif yang tersisa setelah operasi ini.');
  }
  if (cls.unclassified.length) {
    blockers.push(`${cls.unclassified.length} akun UNCLASSIFIED/BLOCKED — selesaikan manual dulu.`);
  }
  const preservedEmails = new Set(cls.preserved.map((u) => u.email));
  const missingSeed = SEED_EMAILS.filter(
    (e) => cls.users.some((u) => u.email === e) && !preservedEmails.has(e),
  );
  if (missingSeed.length) {
    blockers.push(`Akun seed tidak masuk himpunan preserved: ${missingSeed.join(', ')}`);
  }
  const overlap = cls.candidates.filter((u) => preservedEmails.has(u.email));
  if (overlap.length) {
    blockers.push(`${overlap.length} akun ada di kandidat DAN preserved sekaligus.`);
  }
  return blockers;
}

function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  return {
    mode: has('--verify') ? 'verify' : has('--execute') ? 'execute' : 'dry-run',
    backupConfirmed: has('--backup-confirmed'),
    nonInteractiveOk: has('--yes-i-am-sure'),
  };
}

function checkExecuteGuards(args, env, isTty) {
  const blockers = [];
  if (String(env.ALLOW_SANITY_USER_DEACTIVATION).toLowerCase() !== 'true') {
    blockers.push('ALLOW_SANITY_USER_DEACTIVATION=true belum diset di environment.');
  }
  if (!args.backupConfirmed) {
    blockers.push('--backup-confirmed tidak diberikan (backup/snapshot DB wajib lebih dulu).');
  }
  if (!isTty && !args.nonInteractiveOk) {
    blockers.push('Berjalan non-interaktif tanpa --yes-i-am-sure — konfirmasi tidak bisa dilewati diam-diam.');
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// Aksi
// ---------------------------------------------------------------------------

/**
 * Nonaktifkan tepat sejumlah id yang sudah dihitung. Satu transaksi; kalau
 * jumlah baris terpengaruh tidak sama persis dengan yang diharapkan (ada yang
 * berubah di antara perhitungan dan update), ROLLBACK.
 */
async function deactivate(client, expectedIds) {
  await client.query('BEGIN');
  try {
    // Kunci barisnya supaya tidak ada yang menyelip di antara hitung dan update.
    const { rows: locked } = await client.query(
      `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND is_active FOR UPDATE`,
      [expectedIds],
    );
    if (locked.length !== expectedIds.length) {
      throw new Error(
        `Set kandidat berubah: diharapkan ${expectedIds.length} baris aktif, ditemukan ${locked.length}`,
      );
    }
    const res = await client.query(
      `UPDATE users SET is_active = FALSE WHERE id = ANY($1::bigint[]) AND is_active`,
      [expectedIds],
    );
    if (res.rowCount !== expectedIds.length) {
      throw new Error(`Jumlah tidak cocok: ${res.rowCount} diperbarui, ${expectedIds.length} diharapkan`);
    }
    await client.query('COMMIT');
    return res.rowCount;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Laporan
// ---------------------------------------------------------------------------

function pad(label, value) {
  return `  ${String(label).padEnd(40)}${String(value).padStart(10)}`;
}

function byRole(list) {
  const m = new Map();
  for (const u of list) m.set(u.role, (m.get(u.role) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function printBanner(args, cls) {
  const t = describeTarget();
  console.log('KESH SANITY USER DEACTIVATION');
  console.log(`  mode                : ${args.mode.toUpperCase()}`);
  console.log(`  DATABASE HOST       : ${t.host}:${t.port}`);
  console.log(`  DATABASE NAME       : ${t.database}`);
  console.log(`  DATABASE USER       : ${t.user}`);
  console.log(`  NODE_ENV / APP_ENV  : ${process.env.NODE_ENV || '(unset)'} / ${process.env.APP_ENV || '(unset)'}`);
  if (cls) {
    console.log(`  KANDIDAT            : ${cls.candidates.length}`);
    console.log(`  DIPERTAHANKAN       : ${cls.preserved.length}`);
  }
  console.log('');
}

function report(cls) {
  console.log(`Candidates: ${cls.candidates.length}`);
  console.log('\nBy role:');
  for (const [role, n] of byRole(cls.candidates)) console.log(pad(role, n));

  console.log(`\nWill preserve:`);
  console.log(pad(`${cls.preserved.length} akun internal (email non-sanity)`, ''));
  for (const [role, n] of byRole(cls.preserved)) console.log(pad(`  ${role}`, n));

  if (cls.alreadyInactive.length) {
    console.log(`\nSudah nonaktif (dilewati): ${cls.alreadyInactive.length}`);
  }

  console.log(`\nActive SystemAdmin before: ${cls.activeAdminsBefore.length}`);
  console.log(`Active SystemAdmin after : ${cls.activeAdminsAfter.length}`);

  console.log(`\nBLOCKED/UNCLASSIFIED: ${cls.unclassified.length}`);
  for (const u of cls.unclassified.slice(0, 20)) {
    console.log(`  - id=${u.id} ${u.email} (${u.role}) — ${u.reason}`);
  }
  if (cls.unclassified.length > 20) console.log(`  ... dan ${cls.unclassified.length - 20} lainnya`);
}

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

async function runDryRun(client, args) {
  const cls = await classifyUsers(client);
  printBanner(args, cls);
  console.log('— DRY RUN —\n');
  report(cls);

  const blockers = checkInvariants(cls);
  if (blockers.length) {
    console.error('\nEKSEKUSI AKAN DITOLAK:');
    for (const b of blockers) console.error(`  - ${b}`);
  }
  console.log('\nNo user has been modified.');
}

async function confirmInteractive() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(`\nKetik persis "${CONFIRM_PHRASE}" untuk lanjut: `, res));
  rl.close();
  return answer.trim() === CONFIRM_PHRASE;
}

async function runExecute(client, args) {
  const cls = await classifyUsers(client);
  printBanner(args, cls);
  report(cls);

  const blockers = [
    ...checkExecuteGuards(args, process.env, Boolean(process.stdin.isTTY)),
    ...checkInvariants(cls),
  ];
  if (blockers.length) {
    console.error('\nEKSEKUSI DITOLAK:');
    for (const b of blockers) console.error(`  - ${b}`);
    process.exitCode = 1;
    return;
  }
  if (!cls.candidates.length) {
    console.log('\nTidak ada kandidat — tidak ada yang dikerjakan.');
    return;
  }
  if (process.stdin.isTTY && !(await confirmInteractive())) {
    console.error('\nKonfirmasi tidak cocok — dibatalkan. Tidak ada user yang diubah.');
    process.exitCode = 1;
    return;
  }

  try {
    const n = await deactivate(client, cls.candidates.map((u) => u.id));
    console.log(`\nSelesai — ${n} akun dinonaktifkan (is_active=false). Tidak ada baris yang dihapus.`);
    console.log('Jalankan --verify untuk konfirmasi.');
  } catch (e) {
    console.error(`\nGAGAL — ROLLBACK, tidak ada perubahan: ${e.message}`);
    process.exitCode = 1;
  }
}

async function runVerify(client, args) {
  printBanner(args, null);
  const results = [];
  const check = (name, pass, detail = '') => results.push({ name, pass, detail });

  const cls = await classifyUsers(client);

  const { rows: activeSanity } = await client.query(
    `SELECT count(*)::int n FROM users WHERE email LIKE $1 AND is_active`,
    [SANITY_EMAIL_LIKE],
  );
  check('nol akun sanity yang masih aktif', activeSanity[0].n === 0, `${activeSanity[0].n} aktif`);

  check('akun internal masih ada', cls.preserved.length > 0, `${cls.preserved.length} akun non-sanity`);
  const inactiveInternal = cls.preserved.filter((u) => !u.is_active);
  check(
    'akun internal tetap aktif',
    inactiveInternal.length === 0,
    inactiveInternal.length ? `${inactiveInternal.length} internal nonaktif: ${inactiveInternal.map((u) => u.email).join(', ')}` : 'semua aktif',
  );

  check('minimal satu SystemAdmin aktif', cls.activeAdminsBefore.length > 0, `${cls.activeAdminsBefore.length} aktif`);

  const { rows: roleRows } = await client.query('SELECT count(*)::int n FROM roles');
  check('master roles tidak kosong', roleRows[0].n > 0, `${roleRows[0].n} role`);

  const { rows: domains } = await client.query(
    `SELECT count(*)::int n FROM users WHERE email NOT LIKE $1 AND email NOT LIKE '%@%'`,
    [SANITY_EMAIL_LIKE],
  );
  check('tidak ada email yang rusak/berubah bentuk', domains[0].n === 0, `${domains[0].n} email tanpa "@"`);

  check('tidak ada akun UNCLASSIFIED tersisa', cls.unclassified.length === 0, `${cls.unclassified.length} unclassified`);

  console.log('HASIL VERIFIKASI');
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }
  console.log(`\n${failed === 0 ? 'SEMUA CHECK PASS' : `${failed} CHECK GAGAL`}`);
  console.log(
    `Total akun: ${cls.users.length} (skrip ini tidak pernah menghapus baris — ` +
      `bandingkan dengan jumlah sebelum dijalankan).`,
  );
  if (failed) process.exitCode = 1;
  return results;
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
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
  SANITY_EMAIL_LIKE,
  SEED_EMAILS,
  NEVER_DEACTIVATE_ROLES,
  classifyUsers,
  checkInvariants,
  checkExecuteGuards,
  parseArgs,
  deactivate,
  runVerify,
};
