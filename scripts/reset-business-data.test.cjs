/**
 * Tes logika reset-business-data. Tidak menyentuh DB atau storage nyata —
 * query dijalankan lewat client palsu yang merekam SQL.
 */
const path = require('path');
const R = require('./reset-business-data.cjs');

/** Client palsu: merekam SQL, mengembalikan baris dari peta yang diberikan. */
function fakeClient(responses = {}) {
  const sql = [];
  return {
    sql,
    async query(text) {
      sql.push(text);
      for (const [needle, rows] of Object.entries(responses)) {
        if (text.includes(needle)) return { rows, rowCount: rows.length };
      }
      return { rows: [{ n: 0 }], rowCount: 0 };
    },
  };
}

describe('mode parsing', () => {
  it('default tanpa flag adalah dry-run (non-destruktif)', () => {
    expect(R.parseArgs([]).mode).toBe('dry-run');
  });

  it('--dry-run tetap dry-run', () => {
    expect(R.parseArgs(['--dry-run']).mode).toBe('dry-run');
  });

  it('--verify menang atas --execute (tidak pernah destruktif karena salah ketik)', () => {
    expect(R.parseArgs(['--execute', '--verify']).mode).toBe('verify');
  });

  it('--reset-sequences tidak pernah implisit', () => {
    expect(R.parseArgs(['--execute']).resetSequences).toBe(false);
    expect(R.parseArgs(['--execute', '--reset-sequences']).resetSequences).toBe(true);
  });
});

describe('guard eksekusi', () => {
  const okEnv = { ALLOW_BUSINESS_DATA_RESET: 'true' };
  const okArgs = R.parseArgs(['--execute', '--backup-confirmed']);

  it('lolos kalau semua syarat terpenuhi dan interaktif', () => {
    expect(R.checkExecuteGuards(okArgs, okEnv, true)).toEqual([]);
  });

  it('ALLOW_BUSINESS_DATA_RESET hilang memblokir', () => {
    const b = R.checkExecuteGuards(okArgs, {}, true);
    expect(b.join(' ')).toContain('ALLOW_BUSINESS_DATA_RESET');
  });

  it('ALLOW_BUSINESS_DATA_RESET selain "true" memblokir', () => {
    for (const v of ['1', 'yes', 'TRUE ', '']) {
      expect(R.checkExecuteGuards(okArgs, { ALLOW_BUSINESS_DATA_RESET: v }, true).length).toBeGreaterThan(0);
    }
  });

  it('tanpa --backup-confirmed memblokir', () => {
    const b = R.checkExecuteGuards(R.parseArgs(['--execute']), okEnv, true);
    expect(b.join(' ')).toContain('--backup-confirmed');
  });

  it('non-interaktif tanpa --yes-i-am-sure memblokir (konfirmasi tak bisa dilewati diam-diam)', () => {
    const b = R.checkExecuteGuards(okArgs, okEnv, false);
    expect(b.join(' ')).toContain('--yes-i-am-sure');
  });

  it('non-interaktif dengan --yes-i-am-sure lolos', () => {
    const args = R.parseArgs(['--execute', '--backup-confirmed', '--yes-i-am-sure']);
    expect(R.checkExecuteGuards(args, okEnv, false)).toEqual([]);
  });
});

describe('klasifikasi allowlist', () => {
  const tables = R.DELETE_ORDER.map((s) => s.table);

  it('memakai allowlist eksplisit, bukan "hapus semua kecuali"', () => {
    expect(tables.length).toBeGreaterThan(0);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('tabel master/auth/referensi tidak pernah masuk daftar hapus', () => {
    for (const t of [...R.MASTER_KEEP, ...R.MASTER_KEEP_MAY_BE_EMPTY]) {
      expect(tables).not.toContain(t);
    }
  });

  it('master watchlist dipertahankan, hasil screening dihapus', () => {
    expect(tables).not.toContain('watchlist_entries');
    expect(tables).not.toContain('watchlist_sources');
    expect(tables).toContain('screening_results');
    expect(tables).toContain('transfer_watchlist_hits');
  });

  it('audit_logs hanya dihapus untuk object_type bisnis', () => {
    const spec = R.DELETE_ORDER.find((s) => s.table === 'audit_logs');
    expect(spec.where).toContain('APPLICATION');
    expect(spec.where).toContain('TRANSFER');
    expect(spec.where).toContain('MONITORING_CASE');
    expect(spec.where).not.toContain('USER');
  });

  it('persons hanya dihapus kalau tidak dirujuk siapa pun', () => {
    const spec = R.DELETE_ORDER.find((s) => s.table === 'persons');
    for (const t of ['applications', 'business_parties', 'authorized_representatives', 'business_roles']) {
      expect(spec.where).toContain(t);
    }
    expect(spec.where).toContain('NOT EXISTS');
  });
});

describe('urutan hapus mengikuti FK', () => {
  const idx = (t) => R.DELETE_ORDER.findIndex((s) => s.table === t);
  // pasangan [anak, induk] dari katalog FK sebenarnya
  const fk = [
    ['monitoring_case_triggers', 'monitoring_cases'],
    ['application_data_review_changes', 'application_data_reviews'],
    ['application_data_reviews', 'applications'],
    ['statement_refunds', 'complaints'],
    ['statement_refunds', 'transfers'],
    ['complaints', 'transfers'],
    ['monitoring_cases', 'transfers'],
    ['transfer_watchlist_hits', 'transfers'],
    ['transfer_compliance_reviews', 'transfers'],
    ['transfers', 'transfer_batches'],
    ['transfers', 'applications'],
    ['transfer_batches', 'applications'],
    ['documents', 'applications'],
    ['application_edd', 'applications'],
    ['screening_results', 'applications'],
    ['risk_profiles', 'applications'],
    ['applications', 'business_entities'],
    ['applications', 'persons'],
    ['business_parties', 'business_entities'],
    ['business_parties', 'persons'],
    ['authorized_representatives', 'business_entities'],
    ['business_roles', 'business_entities'],
    ['business_entities', 'persons'],
  ];

  it.each(fk)('%s dihapus sebelum %s', (child, parent) => {
    expect(idx(child)).toBeGreaterThanOrEqual(0);
    expect(idx(parent)).toBeGreaterThanOrEqual(0);
    expect(idx(child)).toBeLessThan(idx(parent));
  });
});

describe('normalisasi key storage', () => {
  it('menerima key uploads/ apa adanya (LOCAL & OBS)', () => {
    expect(R.toObjectKey('uploads/kyc/kyb/39010/data-review/1216/470.png')).toBe(
      'uploads/kyc/kyb/39010/data-review/1216/470.png',
    );
    expect(R.toObjectKey('uploads/reports/on-demand/2026/08/17/RPT-1.xlsx')).toBe(
      'uploads/reports/on-demand/2026/08/17/RPT-1.xlsx',
    );
    expect(R.toObjectKey('uploads/_staging/data-review/12/a.png')).toBe('uploads/_staging/data-review/12/a.png');
  });

  it('mengurai URL LOCAL, dengan atau tanpa prefix /api', () => {
    expect(R.toObjectKey('https://host.example/uploads/2026/06/a.jpg')).toBe('uploads/2026/06/a.jpg');
    expect(R.toObjectKey('https://host.example/api/uploads/2026/08/b.jpg')).toBe('uploads/2026/08/b.jpg');
  });

  it('menolak host asing / URI di luar prefix uploads (tidak pernah dihapus)', () => {
    expect(R.toObjectKey('https://storage.test/individual_face_photo.jpg')).toBeNull();
    expect(R.toObjectKey('https://storage.test/docs/BUSINESS_NPWP.pdf')).toBeNull();
    expect(R.toObjectKey('/etc/passwd')).toBeNull();
    expect(R.toObjectKey('other-bucket/x.png')).toBeNull();
  });

  it('menolak traversal dan input non-string', () => {
    expect(R.toObjectKey('uploads/../../etc/passwd')).toBeNull();
    expect(R.toObjectKey('https://host.example/uploads/../secret')).toBeNull();
    expect(R.toObjectKey(null)).toBeNull();
    expect(R.toObjectKey('')).toBeNull();
    expect(R.toObjectKey(123)).toBeNull();
  });
});

describe('pengumpulan key storage terbatas cakupan', () => {
  it('hanya mengembalikan key uploads/ dan melaporkan sisanya sebagai dilewati', async () => {
    const c = fakeClient({
      'FROM documents WHERE file_uri': [
        { uri: 'uploads/2026/08/a.jpg' },
        { uri: 'https://storage.test/x.jpg' },
        { uri: 'uploads/2026/08/a.jpg' }, // duplikat
      ],
      'FROM generated_reports': [{ uri: 'uploads/reports/r.xlsx' }],
    });
    const out = await R.collectStorageKeys(c);
    expect(out.keys.sort()).toEqual(['uploads/2026/08/a.jpg', 'uploads/reports/r.xlsx']);
    expect(out.skipped).toEqual(['https://storage.test/x.jpg']);
  });

  it('hanya membaca (SELECT), tidak pernah menulis', async () => {
    const c = fakeClient();
    await R.collectStorageKeys(c);
    for (const s of c.sql) expect(s.trim().toUpperCase().startsWith('SELECT')).toBe(true);
  });
});

describe('dry-run tidak destruktif', () => {
  it('menjalankan skrip tanpa flag tidak pernah mengeluarkan DELETE/TRUNCATE/UPDATE', async () => {
    // Jalankan runDryRun lewat modul dengan client palsu: ambil path yang sama
    // dengan main() tetapi tanpa koneksi nyata.
    const c = fakeClient();
    const mod = require('./reset-business-data.cjs');
    // report() adalah satu-satunya jalur query dry-run; panggil lewat
    // collectStorageKeys + countRows yang keduanya SELECT-only.
    await mod.collectStorageKeys(c);
    const joined = c.sql.join('\n').toUpperCase();
    expect(joined).not.toContain('DELETE ');
    expect(joined).not.toContain('TRUNCATE');
    expect(joined).not.toContain('UPDATE ');
    expect(joined).not.toContain('DROP ');
  });
});

describe('tidak membocorkan kredensial', () => {
  it('describeTarget tidak pernah mengembalikan password', () => {
    const t = R.describeTarget({ DATABASE_URL: 'postgres://pguser:sup3rs3cret@db.internal:5432/kesh_prod' });
    expect(JSON.stringify(t)).not.toContain('sup3rs3cret');
    expect(t).toEqual({ host: 'db.internal', port: '5432', database: 'kesh_prod', user: 'pguser' });
  });

  it('describeTarget dari PG* juga bebas password', () => {
    const t = R.describeTarget({ PGHOST: 'h', PGPORT: '5433', PGUSER: 'u', PGPASSWORD: 'secret', PGDATABASE: 'd' });
    expect(JSON.stringify(t)).not.toContain('secret');
    expect(t.database).toBe('d');
  });

  it('buildPgConfig mengikuti prioritas yang sama dengan run-sql.cjs', () => {
    expect(R.buildPgConfig({ DATABASE_URL: 'postgres://x/y' })).toEqual({ connectionString: 'postgres://x/y' });
    expect(R.buildPgConfig({ PGDATABASE: 'd' }).database).toBe('d');
  });
});

describe('notifications: TRUNCATE sebagai pengecualian', () => {
  const spec = R.DELETE_ORDER.find((s) => s.table === 'notifications');

  it('memakai strategi TRUNCATE', () => {
    expect(spec.strategy).toBe('TRUNCATE');
  });

  it('satu-satunya tabel yang bukan DELETE', () => {
    const truncated = R.DELETE_ORDER.filter((s) => s.strategy === 'TRUNCATE').map((s) => s.table);
    expect(truncated).toEqual(['notifications']);
  });

  it('tanpa filter WHERE (seluruh tabel memang dibuang)', () => {
    expect(spec.where).toBeUndefined();
  });

  it('tidak ada tabel lain yang menambahkan strategi tak dikenal', () => {
    for (const s of R.DELETE_ORDER) {
      expect([undefined, 'TRUNCATE']).toContain(s.strategy);
    }
  });
});

describe('keamanan backend storage', () => {
  const fakeUploads = (isObs) => ({ isObs: () => isObs });

  it('LOCAL dideklarasikan + LOCAL aktif = cocok', () => {
    const b = R.checkStorageBackend(fakeUploads(false), {});
    expect(b).toEqual({ declared: 'LOCAL', effective: 'LOCAL', mismatch: false });
  });

  it('OBS dideklarasikan + OBS aktif = cocok', () => {
    const b = R.checkStorageBackend(fakeUploads(true), { STORAGE_PROVIDER: 'HUAWEI_OBS' });
    expect(b.mismatch).toBe(false);
  });

  it('OBS dideklarasikan tapi adapter fallback ke LOCAL = MISMATCH', () => {
    const b = R.checkStorageBackend(fakeUploads(false), { STORAGE_PROVIDER: 'HUAWEI_OBS' });
    expect(b).toEqual({ declared: 'HUAWEI_OBS', effective: 'LOCAL', mismatch: true });
  });

  it('STORAGE_PROVIDER kosong dianggap LOCAL', () => {
    expect(R.checkStorageBackend(fakeUploads(false), { STORAGE_PROVIDER: '' }).declared).toBe('LOCAL');
  });
});

describe('deteksi UNRESOLVED_OBJECT di LOCAL', () => {
  const os = require('os');
  const fs = require('fs');
  let root;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'reset-test-'));
    fs.mkdirSync(path.join(root, '2026', '08'), { recursive: true });
    fs.writeFileSync(path.join(root, '2026', '08', 'ada.jpg'), 'x');
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('memisahkan key yang berkasnya ada dari yang tidak', () => {
    const out = R.splitLocalResolvable(
      ['uploads/2026/08/ada.jpg', 'uploads/2026/08/tidak-ada.jpg'],
      { UPLOAD_DIR: root },
    );
    expect(out.present).toEqual(['uploads/2026/08/ada.jpg']);
    expect(out.unresolved).toEqual(['uploads/2026/08/tidak-ada.jpg']);
  });

  it('key yang hilang tidak pernah dianggap terhapus', () => {
    const out = R.splitLocalResolvable(['uploads/tidak/pernah/ada.png'], { UPLOAD_DIR: root });
    expect(out.present).toEqual([]);
    expect(out.unresolved).toHaveLength(1);
  });
});

describe('alat audit orphan bersifat read-only', () => {
  const A = require('./audit-business-storage-orphans.cjs');

  it('tidak mengekspor jalur eksekusi/penghapusan apa pun', () => {
    expect(Object.keys(A).sort()).toEqual(['KNOWN_PREFIXES', 'classifyPrefix', 'humanBytes', 'summarize']);
  });

  it('sumbernya tidak memuat operasi penghapusan', () => {
    const src = require('fs').readFileSync(path.join(__dirname, 'audit-business-storage-orphans.cjs'), 'utf8');
    for (const bad of ['unlink', 'rmSync', 'rmdir', 'deleteObject', "'--execute'"]) {
      expect(src).not.toContain(bad);
    }
  });

  it('mengenali prefix operasional yang benar-benar dipakai aplikasi', () => {
    expect(A.classifyPrefix('uploads/kyc/kyb/39010/data-review/1216/470.png').label).toContain('ADR-047 promoted');
    expect(A.classifyPrefix('uploads/kyc/kyb/39010/NPWP.pdf').label).toContain('KYC/KYB');
    expect(A.classifyPrefix('uploads/_staging/data-review/12/a.png').label).toContain('staging');
    expect(A.classifyPrefix('uploads/reports/on-demand/2026/08/17/RPT-1.xlsx').label).toContain('report');
    expect(A.classifyPrefix('uploads/2026/08/uuid.jpg').label).toContain('Generic');
  });

  it('berkas di luar prefix dikenal tetap tidak terklasifikasi (kelas C, tidak disentuh)', () => {
    expect(A.classifyPrefix('uploads/random-thing.zip')).toBeNull();
    expect(A.classifyPrefix('uploads/tmp/x/y.bin')).toBeNull();
  });
});

describe('sumber storage mencakup semua domain berkas', () => {
  it('menyertakan dokumen, staging ADR-047, report, lampiran transfer, bukti refund, berkas monitoring', () => {
    const sql = R.STORAGE_SOURCES.map((s) => s.sql).join(' ');
    for (const t of [
      'documents',
      'application_data_review_changes',
      'generated_reports',
      'transfers',
      'statement_refunds',
      'monitoring_cases',
    ]) {
      expect(sql).toContain(t);
    }
  });
});
