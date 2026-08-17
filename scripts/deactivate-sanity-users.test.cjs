/**
 * Tes untuk scripts/deactivate-sanity-users.cjs.
 *
 * Bagian integrasi berjalan di SCHEMA SEKALI PAKAI (`sanity_cleanup_test_<pid>`)
 * berisi tabel users/roles-nya sendiri. `search_path` diarahkan ke schema itu,
 * jadi tabel `public.users` milik DB pengembangan TIDAK PERNAH disentuh —
 * schema-nya dibuat di awal dan di-DROP di akhir.
 */
const { Client } = require('pg');
const D = require('./deactivate-sanity-users.cjs');
const { buildPgConfig } = require('./reset-business-data.cjs');

const SCHEMA = `sanity_cleanup_test_${process.pid}`;

let client;
let dbAvailable = true;

async function resetFixture(users) {
  await client.query(`TRUNCATE ${SCHEMA}.users`);
  for (const u of users) {
    await client.query(
      `INSERT INTO ${SCHEMA}.users (email, role, is_active) VALUES ($1,$2,$3)`,
      [u.email, u.role, u.is_active !== false],
    );
  }
}

/** Cerminan dunia nyata: sedikit akun internal + banyak fixture @test.local. */
const REALISTIC = [
  { email: 'sysadmin@kesh.local', role: 'SystemAdmin' },
  { email: 'admin@example.com', role: 'ComplianceLead' },
  { email: 'director@kesh.co.id', role: 'Director' },
  { email: 'operation.supervisor@kesh.co.id', role: 'OperationSupervisor' },
  { email: 'frontliner@gmail.com', role: 'FrontDesk' },
  { email: 'staff1@test.local', role: 'FinanceStaff' },
  { email: 'staff2@test.local', role: 'FinanceStaff' },
  { email: 'frontdesk1@test.local', role: 'FrontDesk' },
  { email: 'auditor1@test.local', role: 'Auditor' },
  { email: 'coo1@test.local', role: 'COO' },
  { email: 'old1@test.local', role: 'FrontDesk', is_active: false },
];

beforeAll(async () => {
  client = new Client(buildPgConfig());
  try {
    await client.connect();
  } catch {
    dbAvailable = false;
    return;
  }
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await client.query(`SET search_path TO ${SCHEMA}`);
  await client.query(`CREATE TABLE ${SCHEMA}.roles (id BIGSERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL)`);
  await client.query(`
    CREATE TABLE ${SCHEMA}.users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE
    )`);
  for (const r of ['SystemAdmin', 'ComplianceLead', 'Director', 'OperationSupervisor', 'FrontDesk', 'FinanceStaff', 'Auditor', 'COO']) {
    await client.query(`INSERT INTO ${SCHEMA}.roles(name) VALUES ($1)`, [r]);
  }
}, 30000);

afterAll(async () => {
  if (!client) return;
  if (dbAvailable) await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

const itDb = () => (dbAvailable ? it : it.skip);

// ---------------------------------------------------------------------------

describe('mode & default', () => {
  it('default tanpa flag adalah dry-run', () => {
    expect(D.parseArgs([]).mode).toBe('dry-run');
  });

  it('--verify menang atas --execute', () => {
    expect(D.parseArgs(['--execute', '--verify']).mode).toBe('verify');
  });
});

describe('guard eksekusi', () => {
  const okEnv = { ALLOW_SANITY_USER_DEACTIVATION: 'true' };
  const okArgs = D.parseArgs(['--execute', '--backup-confirmed']);

  it('lolos kalau semua syarat terpenuhi', () => {
    expect(D.checkExecuteGuards(okArgs, okEnv, true)).toEqual([]);
  });

  it('ALLOW_SANITY_USER_DEACTIVATION hilang memblokir', () => {
    expect(D.checkExecuteGuards(okArgs, {}, true).join(' ')).toContain('ALLOW_SANITY_USER_DEACTIVATION');
  });

  it('nilai selain "true" memblokir', () => {
    for (const v of ['1', 'yes', '']) {
      expect(D.checkExecuteGuards(okArgs, { ALLOW_SANITY_USER_DEACTIVATION: v }, true).length).toBeGreaterThan(0);
    }
  });

  it('tanpa --backup-confirmed memblokir', () => {
    expect(D.checkExecuteGuards(D.parseArgs(['--execute']), okEnv, true).join(' ')).toContain('--backup-confirmed');
  });

  it('non-interaktif tanpa --yes-i-am-sure memblokir', () => {
    expect(D.checkExecuteGuards(okArgs, okEnv, false).join(' ')).toContain('--yes-i-am-sure');
  });

  it('frasa konfirmasi tepat sesuai spesifikasi', () => {
    expect(D.CONFIRM_PHRASE).toBe('DEACTIVATE-KESH-SANITY-USERS');
  });
});

describe('bentuk aturan seleksi', () => {
  it('tidak pernah menonaktifkan SystemAdmin otomatis', () => {
    expect(D.NEVER_DEACTIVATE_ROLES).toContain('SystemAdmin');
  });

  it('sumber sanity hanya domain @test.local', () => {
    expect(D.SANITY_EMAIL_LIKE).toBe('%@test.local');
  });

  it('tidak memakai id numerik hardcoded untuk himpunan preserved', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'deactivate-sanity-users.cjs'), 'utf8');
    expect(src).not.toMatch(/PRESERVED_IDS|id\s*IN\s*\(\s*\d/);
  });

  it('tidak pernah memakai DELETE terhadap users', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'deactivate-sanity-users.cjs'), 'utf8');
    expect(src).not.toMatch(/DELETE\s+FROM\s+users/i);
  });
});

describe('klasifikasi (schema sekali pakai)', () => {
  beforeEach(async () => {
    if (dbAvailable) await resetFixture(REALISTIC);
  });

  itDb()('memilih hanya akun sanity yang aktif', async () => {
    const cls = await D.classifyUsers(client);
    expect(cls.candidates.map((u) => u.email).sort()).toEqual([
      'auditor1@test.local',
      'coo1@test.local',
      'frontdesk1@test.local',
      'staff1@test.local',
      'staff2@test.local',
    ]);
  });

  itDb()('mengecualikan seluruh akun internal', async () => {
    const cls = await D.classifyUsers(client);
    expect(cls.preserved.map((u) => u.email).sort()).toEqual([
      'admin@example.com',
      'director@kesh.co.id',
      'frontliner@gmail.com',
      'operation.supervisor@kesh.co.id',
      'sysadmin@kesh.local',
    ]);
    for (const u of cls.candidates) expect(u.email).toMatch(/@test\.local$/);
  });

  itDb()('akun yang sudah nonaktif dilewati, bukan dihitung ulang', async () => {
    const cls = await D.classifyUsers(client);
    expect(cls.alreadyInactive.map((u) => u.email)).toEqual(['old1@test.local']);
  });

  itDb()('SystemAdmin ber-email sanity jadi UNCLASSIFIED, bukan kandidat', async () => {
    await resetFixture([...REALISTIC, { email: 'sysadmin9@test.local', role: 'SystemAdmin' }]);
    const cls = await D.classifyUsers(client);
    expect(cls.candidates.some((u) => u.role === 'SystemAdmin')).toBe(false);
    expect(cls.unclassified.map((u) => u.email)).toContain('sysadmin9@test.local');
    expect(D.checkInvariants(cls).join(' ')).toContain('UNCLASSIFIED');
  });

  itDb()('role di luar master roles jadi UNCLASSIFIED dan memblokir', async () => {
    await resetFixture([...REALISTIC, { email: 'ghost1@test.local', role: 'NotARole' }]);
    const cls = await D.classifyUsers(client);
    expect(cls.unclassified.map((u) => u.reason).join(' ')).toContain('master roles');
    expect(D.checkInvariants(cls).length).toBeGreaterThan(0);
  });

  itDb()('invarian SystemAdmin: abort kalau tidak ada admin aktif tersisa', async () => {
    await resetFixture([
      { email: 'sysadmin@kesh.local', role: 'SystemAdmin', is_active: false },
      { email: 'staff1@test.local', role: 'FinanceStaff' },
    ]);
    const cls = await D.classifyUsers(client);
    expect(cls.activeAdminsAfter.length).toBe(0);
    expect(D.checkInvariants(cls).join(' ')).toContain('SystemAdmin aktif');
  });

  itDb()('invarian lolos pada fixture realistis', async () => {
    const cls = await D.classifyUsers(client);
    expect(cls.activeAdminsBefore.length).toBe(1);
    expect(cls.activeAdminsAfter.length).toBe(1);
    expect(D.checkInvariants(cls)).toEqual([]);
  });
});

describe('eksekusi & verifikasi (schema sekali pakai)', () => {
  beforeEach(async () => {
    if (dbAvailable) await resetFixture(REALISTIC);
  });

  itDb()('dry-run / klasifikasi tidak mengubah satu baris pun', async () => {
    const before = await client.query('SELECT id, is_active FROM users ORDER BY id');
    await D.classifyUsers(client);
    const after = await client.query('SELECT id, is_active FROM users ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });

  itDb()('menonaktifkan tepat himpunan kandidat, tanpa menghapus baris', async () => {
    const cls = await D.classifyUsers(client);
    const totalBefore = cls.users.length;
    const n = await D.deactivate(client, cls.candidates.map((u) => u.id));
    expect(n).toBe(5);

    const { rows } = await client.query('SELECT email, is_active FROM users ORDER BY email');
    expect(rows).toHaveLength(totalBefore); // tidak ada yang dihapus
    for (const r of rows) {
      if (r.email.endsWith('@test.local')) expect(r.is_active).toBe(false);
      else expect(r.is_active).toBe(true);
    }
  });

  itDb()('ROLLBACK kalau himpunan kandidat berubah di antara hitung dan update', async () => {
    const cls = await D.classifyUsers(client);
    const ids = cls.candidates.map((u) => u.id);
    // satu id palsu -> jumlah tidak cocok -> harus rollback
    await expect(D.deactivate(client, [...ids, 999999])).rejects.toThrow(/berubah|cocok/);
    const { rows } = await client.query(
      "SELECT count(*)::int n FROM users WHERE email LIKE '%@test.local' AND is_active",
    );
    expect(rows[0].n).toBe(5); // tidak ada yang berubah
  });

  itDb()('verify GAGAL selama masih ada akun sanity aktif', async () => {
    const results = await D.runVerify(client, { mode: 'verify' });
    const c = results.find((r) => r.name.includes('nol akun sanity'));
    expect(c.pass).toBe(false);
  });

  itDb()('verify PASS setelah deaktivasi', async () => {
    const cls = await D.classifyUsers(client);
    await D.deactivate(client, cls.candidates.map((u) => u.id));
    const results = await D.runVerify(client, { mode: 'verify' });
    const failed = results.filter((r) => !r.pass);
    expect(failed.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
  });

  itDb()('verify mendeteksi kalau akun internal ikut ternonaktifkan', async () => {
    await client.query("UPDATE users SET is_active=FALSE WHERE email='frontliner@gmail.com'");
    const results = await D.runVerify(client, { mode: 'verify' });
    const c = results.find((r) => r.name.includes('internal tetap aktif'));
    expect(c.pass).toBe(false);
    expect(c.detail).toContain('frontliner@gmail.com');
  });
});
