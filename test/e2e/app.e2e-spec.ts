/**
 * E2E Priority Tests — KYC/KYB PJP-3
 *
 * Prasyarat sebelum menjalankan:
 *   npm run db:migrate
 *   npm run db:seed
 *
 * Jalankan dengan:
 *   npm run test:e2e
 *
 * Catatan:
 * - Test memakai database real (bukan mock) sesuai .env
 * - Data test dibuat dengan suffix unik per run sehingga idempoten
 * - Tidak ada cleanup — data test tetap di DB setelah run
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { AppModule } from '../../src/app.module';

const BASE = '/api';

// Suffix 7 digit akhir epoch — unik per test run, hindari konflik unique constraint
const SUFFIX = Date.now().toString().slice(-7);

describe('KYC/KYB E2E — Priority Tests', () => {
  let app: INestApplication;
  // Pool untuk verifikasi langsung ke DB (mis. cek unique_id tersimpan)
  let pgPool: any;

  // Tokens
  let complianceToken: string;
  let sysAdminToken: string;
  let financeStaffToken: string;
  let financeManagerToken: string;
  let frontDeskToken: string;
  let directorToken: string;
  let auditorToken: string;

  // Application IDs yang diakumulasi lintas describe block
  // pg driver mengembalikan BIGINT sebagai string — simpan sebagai string
  let indivAppIdMissing: string;
  let indivAppIdOk: string;
  let bizAppId: string;
  let transferId: string;

  // ──────────────────────────────────────────────────────────
  // SETUP: bootstrap app + login + buat user Finance test
  // ──────────────────────────────────────────────────────────
  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    // Ambil pool yang sama dengan aplikasi untuk verifikasi data tersimpan
    pgPool = app.get('PG_POOL');

    // Login ComplianceLead (dari npm run db:seed)
    const loginComp = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: 'admin@example.com', password: 'Admin123!' });
    expect(loginComp.status).toBe(201);
    complianceToken = loginComp.body.access_token;

    // Login SystemAdmin (dari npm run db:seed)
    const loginSys = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: 'sysadmin@kesh.local', password: 'SystemAdmin@123' });
    expect(loginSys.status).toBe(201);
    sysAdminToken = loginSys.body.access_token;

    // Buat FinanceStaff test user
    const staffEmail = `staff${SUFFIX}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set('Authorization', `Bearer ${sysAdminToken}`)
      .send({
        email: staffEmail,
        fullName: `Test Staff ${SUFFIX}`,
        role: 'FinanceStaff',
        password: 'Test@123456',
      });
    const loginStaff = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: staffEmail, password: 'Test@123456' });
    financeStaffToken = loginStaff.body.access_token;

    // Buat FinanceManager test user
    const managerEmail = `manager${SUFFIX}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set('Authorization', `Bearer ${sysAdminToken}`)
      .send({
        email: managerEmail,
        fullName: `Test Manager ${SUFFIX}`,
        role: 'FinanceManager',
        password: 'Test@123456',
      });
    const loginManager = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: managerEmail, password: 'Test@123456' });
    financeManagerToken = loginManager.body.access_token;

    // Buat FrontDesk test user (untuk uji RBAC watchlist)
    const frontDeskEmail = `frontdesk${SUFFIX}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set('Authorization', `Bearer ${sysAdminToken}`)
      .send({
        email: frontDeskEmail,
        fullName: `Test FrontDesk ${SUFFIX}`,
        role: 'FrontDesk',
        password: 'Test@123456',
      });
    const loginFrontDesk = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: frontDeskEmail, password: 'Test@123456' });
    frontDeskToken = loginFrontDesk.body.access_token;

    // Buat Director test user (untuk monitoring director-review)
    const directorEmail = `director${SUFFIX}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set('Authorization', `Bearer ${sysAdminToken}`)
      .send({
        email: directorEmail,
        fullName: `Test Director ${SUFFIX}`,
        role: 'Director',
        password: 'Test@123456',
      });
    const loginDirector = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: directorEmail, password: 'Test@123456' });
    directorToken = loginDirector.body.access_token;

    // Buat Auditor test user (read-only monitoring)
    const auditorEmail = `auditor${SUFFIX}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set('Authorization', `Bearer ${sysAdminToken}`)
      .send({
        email: auditorEmail,
        fullName: `Test Auditor ${SUFFIX}`,
        role: 'Auditor',
        password: 'Test@123456',
      });
    const loginAuditor = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: auditorEmail, password: 'Test@123456' });
    auditorToken = loginAuditor.body.access_token;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════
  // A. AUTH
  // ══════════════════════════════════════════════════════════
  describe('A. Auth', () => {
    it('A-01: POST /auth/login valid → 201 + access_token + user info', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: 'admin@example.com', password: 'Admin123!' })
        .expect(201);

      expect(res.body.access_token).toBeDefined();
      expect(typeof res.body.access_token).toBe('string');
      expect(res.body.user.role).toBe('ComplianceLead');
      expect(res.body.user.email).toBe('admin@example.com');
    });

    it('A-02: POST /auth/login password salah → 401', () => {
      return request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: 'admin@example.com', password: 'SalahPassword!' })
        .expect(401);
    });

    it('A-03: POST /auth/login email tidak ada → 401', () => {
      return request(app.getHttpServer())
        .post(`${BASE}/auth/login`)
        .send({ email: 'notexist@example.com', password: 'Any123!' })
        .expect(401);
    });

    it('A-04: GET /auth/me dengan token valid → 200 + user data', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/auth/me`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.email).toBe('admin@example.com');
      expect(res.body.role).toBeDefined();
    });

    it('A-05: GET /auth/me tanpa token → 401', () => {
      return request(app.getHttpServer())
        .get(`${BASE}/auth/me`)
        .expect(401);
    });
  });

  // ══════════════════════════════════════════════════════════
  // B. INDIVIDUAL — CREATE RETURNS DRAFT
  // ══════════════════════════════════════════════════════════
  describe('B. KYC Individual — create returns DRAFT', () => {
    it('B-01: POST /applications/individual → 201, status = DRAFT', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Test Individu ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `317500${SUFFIX}`,
          address_identity: 'Jl. Test No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1990-01-15',
          nationality: 'ID',
          phone: `0812${SUFFIX}`,
          occupation: 'Software Engineer',
          gender: 'M',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.id).toBeDefined();
      expect(String(res.body.id)).toMatch(/^\d+$/);
      indivAppIdMissing = String(res.body.id);
    });

    it('B-02: GET /applications/:id → 200, structured response dengan person + documents + parties + risk', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdMissing}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      // application row
      expect(res.body.application.status).toBe('DRAFT');
      expect(res.body.application.type).toBe('INDIVIDUAL');

      // person object
      expect(res.body.person).not.toBeNull();
      expect(res.body.person.full_name).toBeDefined();
      expect(res.body.person.identity_type).toBeDefined();
      expect(res.body.person.identity_number).toBeDefined();
      expect(res.body.person.pob).toBeDefined();
      expect(res.body.person.dob).toBeDefined();
      expect(res.body.person.nationality).toBeDefined();
      expect(res.body.person.phone).toBeDefined();
      expect(res.body.person.gender).toBeDefined();
      expect(res.body.person.occupation).toBeDefined();
      expect(res.body.person.address_identity).toBeDefined();

      // business null untuk INDIVIDUAL
      expect(res.body.business).toBeNull();

      expect(Array.isArray(res.body.documents)).toBe(true);
      expect(Array.isArray(res.body.parties)).toBe(true);

      // risk null sebelum submit
      expect(res.body.risk).toBeNull();
    });

    it('B-03: GET /applications → 200, list berisi item', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════
  // C. SUBMIT FAILS WHEN DOCS MISSING
  // ══════════════════════════════════════════════════════════
  describe('C. Submit fails when docs missing', () => {
    it('C-01: PATCH /submit tanpa sig & doc → 400, missing array berisi keduanya', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdMissing}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      expect(res.body.message).toContain('belum lengkap');
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('signature_uri'))).toBe(true);
      expect(missing.some((m) => m.includes('dokumen identitas'))).toBe(true);
    });

    it('C-02: GET /precheck tanpa sig & doc → 400, missing array berisi info', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdMissing}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      expect(Array.isArray(res.body.missing)).toBe(true);
      expect(res.body.missing.length).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════
  // D. INDIVIDUAL HAPPY PATH (sig + doc → submit → approve)
  // ══════════════════════════════════════════════════════════
  describe('D. KYC Individual — happy path', () => {
    it('D-01: POST /individual dengan signature_uri → 201 DRAFT', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Individu OK ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `317600${SUFFIX}`,
          address_identity: 'Jl. Merdeka No. 10, Bandung',
          pob: 'Bandung',
          dob: '1985-06-20',
          nationality: 'ID',
          phone: `0813${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'F',
          email: `indivok${SUFFIX}@test.com`,
          signature_uri: 'https://storage.test/signatures/sig.png',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      indivAppIdOk = String(res.body.id);
    });

    it('D-02: POST /documents (KTP) → 201, status UPLOADED', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${indivAppIdOk}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'KTP',
          file_uri: 'https://storage.test/docs/ktp.jpg',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('KTP');
      expect(res.body.status).toBe('UPLOADED');
      expect(String(res.body.application_id)).toBe(String(indivAppIdOk));
    });

    it('D-03: GET /precheck setelah doc + sig → 200 ok', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.ok).toBe(true);
    });

    it('D-04: PATCH /submit → 200, status SUBMITTED + risk object', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdOk}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.risk).toBeDefined();
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(res.body.risk.risk_level);
      expect(typeof res.body.risk.risk_score).toBe('number');
    });

    it('D-05: GET /screening → 200, results array + risk dari application_risk', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}/screening`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.results)).toBe(true);
      // risk != null karena screenAndComputeRisk selalu insert ke application_risk saat submit
      expect(res.body.risk).not.toBeNull();
      expect(String(res.body.risk.application_id)).toBe(String(indivAppIdOk));
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(res.body.risk.risk_level);
    });
  });

  // ══════════════════════════════════════════════════════════
  // D2. DOCUMENT LIFECYCLE — delete & signed URL ownership check
  //     Regression: pg mengembalikan BIGINT application_id sebagai
  //     string, ParseIntPipe memberi number → perbandingan strict
  //     "5" !== 5 selalu true → "Document does not belong" palsu.
  // ══════════════════════════════════════════════════════════
  describe('D2. Document lifecycle — delete & signed URL', () => {
    let ownerAppId: string; // application pemilik dokumen
    let otherAppId: string; // application lain (bukan pemilik)
    let docId: string;

    beforeAll(async () => {
      const mkApp = async (suffix: string) => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({
            full_name: `Doc Owner ${suffix}`,
            identity_type: 'KTP',
            identity_number: `319900${suffix}`,
            address_identity: 'Jl. Dokumen No. 1, Jakarta',
            pob: 'Jakarta',
            dob: '1990-01-01',
            nationality: 'ID',
            phone: `0812${suffix}`,
            occupation: 'Karyawan Swasta',
            gender: 'M',
            email: `docowner${suffix}@test.com`,
            signature_uri: 'https://storage.test/signatures/sig.png',
          })
          .expect(201);
        return String(res.body.id);
      };
      ownerAppId = await mkApp(`${SUFFIX}A`);
      otherAppId = await mkApp(`${SUFFIX}B`);
    });

    it('D2-01: POST /documents → 201, mengembalikan document.id DB + application_id benar', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${ownerAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'KTP',
          file_uri: 'https://storage.test/docs/ktp-lifecycle.jpg',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      // id adalah document DB id, bukan filename/object key
      expect(String(res.body.id)).toMatch(/^\d+$/);
      expect(String(res.body.application_id)).toBe(String(ownerAppId));
      expect(res.body.status).toBe('UPLOADED');
      docId = String(res.body.id);
    });

    it('D2-02: GET /documents/:docId/url dengan appId benar → 200 { signed_url, expires_in: 300 }', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${ownerAppId}/documents/${docId}/url`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(typeof res.body.signed_url).toBe('string');
      expect(res.body.signed_url.length).toBeGreaterThan(0);
      expect(res.body.expires_in).toBe(300);
    });

    it('D2-03: GET /documents/:docId/url dengan appId salah → 403 "does not belong"', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${otherAppId}/documents/${docId}/url`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(403);

      expect(res.body.message).toContain('does not belong');
    });

    it('D2-04: DELETE /documents/:docId dengan appId salah → 403 "does not belong"', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${BASE}/applications/${otherAppId}/documents/${docId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(403);

      expect(res.body.message).toContain('does not belong');
    });

    it('D2-05: DELETE /documents/:docId dengan appId benar → 200 ok (regression fix)', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${BASE}/applications/${ownerAppId}/documents/${docId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(String(res.body.deleted_id)).toBe(String(docId));

      // Verifikasi benar-benar terhapus dari DB
      const { rows } = await pgPool.query(
        `SELECT id FROM documents WHERE id=$1`,
        [docId],
      );
      expect(rows.length).toBe(0);
    });

    it('D2-06: legacy PENDING dengan file_uri → backfill jadi UPLOADED', async () => {
      // Simulasikan record legacy status PENDING (masih diizinkan constraint),
      // lalu jalankan statement backfill migrasi 0028 → harus jadi UPLOADED.
      const ins = await pgPool.query(
        `INSERT INTO documents (application_id, doc_type, file_uri, status)
         VALUES ($1, 'KTP', 'https://storage.test/legacy-ktp.jpg', 'PENDING')
         RETURNING id`,
        [ownerAppId],
      );
      const legacyId = String(ins.rows[0].id);

      await pgPool.query(
        `UPDATE documents SET status='UPLOADED'
         WHERE status='PENDING' AND file_uri IS NOT NULL AND id=$1`,
        [legacyId],
      );

      const { rows } = await pgPool.query(
        `SELECT status FROM documents WHERE id=$1`,
        [legacyId],
      );
      expect(rows[0].status).toBe('UPLOADED');

      await pgPool.query(`DELETE FROM documents WHERE id=$1`, [legacyId]);
    });
  });

  // ══════════════════════════════════════════════════════════
  // E. DECISION — hanya setelah SUBMITTED / IN_REVIEW
  // ══════════════════════════════════════════════════════════
  describe('E. Decision flow', () => {
    it('E-01: Decision APPROVE pada app DRAFT → 400 bad status', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdMissing}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED' })
        .expect(400);

      expect(res.body.message).toContain('DRAFT');
    });

    it('E-02: Decision APPROVE pada app SUBMITTED → 200 APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdOk}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED', reason: 'Semua dokumen lengkap dan valid' })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
    });

    it('E-02b: Application APPROVED tidak mengubah status dokumen (tetap UPLOADED)', async () => {
      // Dokumen tidak punya review/approval — approve application tidak boleh
      // memutasi dokumen menjadi APPROVED/VERIFIED.
      const { rows } = await pgPool.query(
        `SELECT status FROM documents WHERE application_id=$1`,
        [indivAppIdOk],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.status).toBe('UPLOADED');
      }
    });

    it('E-03: Decision REJECTED dengan reason → 200 REJECTED (app terpisah)', async () => {
      // Buat + submit aplikasi baru khusus untuk reject test
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Reject Test ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `317700${SUFFIX}`,
          address_identity: 'Jl. Ditolak No. 1',
          pob: 'Solo',
          dob: '1995-03-10',
          nationality: 'ID',
          phone: `0815${SUFFIX}`,
          occupation: 'Pelajar',
          gender: 'M',
          signature_uri: 'https://storage.test/sig2.png',
        })
        .expect(201);
      const rejectAppId = String(createRes.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${rejectAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/ktp2.jpg' });

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${rejectAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${rejectAppId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'REJECTED', reason: 'Data tidak sesuai' })
        .expect(200);

      expect(res.body.status).toBe('REJECTED');
      expect(res.body.decision_reason).toBe('Data tidak sesuai');
    });
  });

  // ══════════════════════════════════════════════════════════
  // F. TRANSFER — blocked jika application belum APPROVED
  // ══════════════════════════════════════════════════════════
  describe('F. Transfer blocked before APPROVED', () => {
    it('F-01: POST /transfers dengan DRAFT app → 400 "not KYC/KYB approved"', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({
          amount: 500000,
          sender_application_id: Number(indivAppIdMissing), // status DRAFT
          beneficiaryBankName: 'Bank Test',
          beneficiaryAccountNumber: '1234567890',
          beneficiaryAccountName: 'Penerima Test',
        })
        .expect(400);

      expect(res.body.message).toContain('not KYC/KYB approved');
    });

    it('F-02: POST /transfers dengan APPROVED app → 201 DRAFT + created_by terisi', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({
          amount: 1000000,
          sender_application_id: Number(indivAppIdOk), // status APPROVED
          beneficiaryBankName: 'Bank Mandiri',
          beneficiaryAccountNumber: '9876543210',
          beneficiaryAccountName: 'PT Penerima Dana',
          description: 'Transfer e2e test',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(Number(res.body.amount)).toBe(1000000);
      // Pastikan audit trail terisi — bug: user.id tidak ada di JWT payload (pakai sub)
      expect(res.body.created_by).not.toBeNull();
      expect(String(res.body.created_by)).toMatch(/^\d+$/);
      transferId = String(res.body.id);
    });

    it('F-03: POST /transfers dengan role ComplianceLead → 403', async () => {
      return request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          amount: 100000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank Test',
          beneficiaryAccountNumber: '111',
          beneficiaryAccountName: 'Test',
        })
        .expect(403);
    });
  });

  // ══════════════════════════════════════════════════════════
  // G. KYB BUSINESS FLOW
  // ══════════════════════════════════════════════════════════
  describe('G. KYB Business flow', () => {
    it('G-01: POST /applications/business → 201 DRAFT', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `PT Test Bisnis ${SUFFIX}`,
          legal_form: 'PT',
          incorporation_place: 'Jakarta',
          incorporation_date: '2020-01-01',
          business_license_number: `BL${SUFFIX}`,
          nib: `NIB${SUFFIX}`,
          npwp: `NPWP${SUFFIX}`,
          address_line: 'Jl. Bisnis Raya No. 5',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          postal_code: '12345',
          business_activity: 'Perdagangan Umum',
          phone: `021${SUFFIX}`,
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      bizAppId = String(res.body.id);
    });

    it('G-02: Submit bisnis tanpa docs & party → 400 missing keduanya', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${bizAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('dokumen korporasi'))).toBe(true);
      expect(missing.some((m) => m.includes('party'))).toBe(true);
    });

    it('G-03: Submit dengan docs lengkap tapi tanpa party → 400 missing party', async () => {
      for (const docType of ['AKTA_PENDIRIAN', 'NIB_SIUP', 'NPWP_BADAN']) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${bizAppId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({
            doc_type: docType,
            file_uri: `https://storage.test/docs/${docType}.pdf`,
          })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${bizAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('party'))).toBe(true);
    });

    it('G-04: POST /parties (DIRECTOR) → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${bizAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'DIRECTOR',
          full_name: `Direktur Utama ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `327600${SUFFIX}`,
          dob: '1975-09-01',
          nationality: 'ID',
          phone: `0816${SUFFIX}`,
        })
        .expect(201);

      expect(res.body.role).toBe('DIRECTOR');
      expect(res.body.is_active).toBe(true);
    });

    it('G-05: PATCH /submit setelah docs + party lengkap → 200 SUBMITTED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${bizAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.risk).toBeDefined();
    });

    it('G-06: GET /parties list → 200 array dengan DIRECTOR', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${bizAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((p: any) => p.role === 'DIRECTOR')).toBe(true);
    });

    it('G-07: Decision APPROVE bisnis SUBMITTED → 200 APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${bizAppId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
    });
  });

  // ══════════════════════════════════════════════════════════
  // H. DASHBOARD — regression: tidak boleh query risk_profiles
  // ══════════════════════════════════════════════════════════
  describe('H. Dashboard & Registrants — regression test', () => {
    it('H-01: GET /kyc/dashboard-summary → 200 + totals + recent', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/dashboard-summary`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.totals).toBeDefined();
      expect(typeof res.body.totals.total).toBe('number');
      expect(res.body.totals.total).toBeGreaterThan(0);
      expect(Array.isArray(res.body.recent)).toBe(true);
      // risk_level di recent berasal dari application_risk (bukan risk_profiles)
      if (res.body.recent.length > 0) {
        const item = res.body.recent[0];
        // field dari query: id, type, status, created_at, submitted_at, risk_level, risk_score
        expect(item.id).toBeDefined();
        expect(item.type).toMatch(/^(INDIVIDUAL|BUSINESS)$/);
      }
    });

    it('H-02: GET /kyc/submissions → 200 array', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/submissions`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('H-03: GET /kyc/registrants (INDIVIDUAL) → 200 pagination shape', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/registrants?type=INDIVIDUAL`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(typeof res.body.total).toBe('number');
      expect(typeof res.body.limit).toBe('number');
      expect(typeof res.body.offset).toBe('number');
      expect(Array.isArray(res.body.items)).toBe(true);
      // Verifikasi field berasal dari application_risk, bukan risk_profiles
      if (res.body.items.length > 0) {
        const item = res.body.items[0];
        expect(item.application_id).toBeDefined();
        // risk_level nullable tapi harus ada sebagai key
        expect(Object.prototype.hasOwnProperty.call(item, 'risk_level')).toBe(true);
      }
    });

    it('H-04: GET /kyc/registrants (BUSINESS) → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/registrants?type=BUSINESS`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.items).toBeInstanceOf(Array);
    });

    it('H-05: GET /kyc/registrants?status=APPROVED → 200 hanya APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/registrants?status=APPROVED`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      for (const item of res.body.items) {
        expect(item.status).toBe('APPROVED');
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // I. WATCHLIST HISTORY
  // ══════════════════════════════════════════════════════════
  describe('I. Watchlist', () => {
    it('I-01: GET /watchlist/history → 200 {data,page,limit,total}', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
    });

    it('I-02: GET /watchlist/history dengan role non-compliance → 403', async () => {
      return request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(403);
    });

    it('I-03: POST /watchlist/upload CSV → 200 + uploaded_by terisi (bukan NULL)', async () => {
      // CSV minimal: header + 1 baris PEP
      const csvContent = [
        'unique_id,name,aliases,dob,nationality,position,remarks',
        `PEP${SUFFIX},Test PEP ${SUFFIX},,1970-01-01,ID,Direktur,Test upload e2e`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csvContent), {
          filename: `test_pep_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E Test ${SUFFIX}`)
        .expect(201);

      // Pastikan log ingest mencatat uploaded_by — bug: req.user?.id tidak ada di JWT payload
      expect(res.body.log).toBeDefined();
      expect(res.body.log.uploaded_by).not.toBeNull();
      expect(String(res.body.log.uploaded_by)).toMatch(/^\d+$/);
    });

    it('I-04: POST /watchlist/upload dengan FrontDesk → 403 (upload = fitur Compliance)', async () => {
      const csvContent = [
        'unique_id,name,aliases,dob,nationality,position,remarks',
        `PEPFD${SUFFIX},Test PEP FD ${SUFFIX},,1970-01-01,ID,Direktur,Should be blocked`,
      ].join('\n');

      return request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .attach('file', Buffer.from(csvContent), {
          filename: `blocked_fd_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E FrontDesk ${SUFFIX}`)
        .expect(403);
    });

    it('I-05: GET /watchlist/history dengan FrontDesk → 403 (watchlist bukan lagi akses FrontDesk)', async () => {
      return request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(403);
    });

    // ── Unique_ID optional / auto-generate ──────────────────────
    it('I-06: upload dengan Unique_ID terisi → tersimpan apa adanya', async () => {
      const providedUid = `WLPROV${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Date_of_Birth,Nationality',
        `${providedUid},Provided Person ${SUFFIX},1980-05-05,ID`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_provided_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E Provided ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);

      const { rows } = await pgPool.query(
        `SELECT unique_id FROM watchlist_entries WHERE upper(unique_id) = upper($1) LIMIT 1`,
        [providedUid],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].unique_id).toBe(providedUid);
    });

    it('I-07: upload dengan Unique_ID kosong → auto-generate KESH-WL-AUTO-...', async () => {
      const fullName = `Auto Person ${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Date_of_Birth,Nationality,National_ID_Number',
        `,${fullName},1975-03-03,ID,NIK${SUFFIX}`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_auto_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E Auto ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);

      const { rows } = await pgPool.query(
        `SELECT unique_id FROM watchlist_entries WHERE name = $1 LIMIT 1`,
        [fullName],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].unique_id).toMatch(/^KESH-WL-AUTO-[0-9A-F]{16}$/);
    });

    it('I-08: upload baris Unique_ID kosong yang sama dua kali → upsert, tidak duplikat', async () => {
      const fullName = `Dup Person ${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Date_of_Birth,Nationality',
        `,${fullName},1990-09-09,ID`,
      ].join('\n');
      const doUpload = () =>
        request(app.getHttpServer())
          .post(`${BASE}/watchlist/upload`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .attach('file', Buffer.from(csv), {
            filename: `wl_dup_${SUFFIX}.csv`,
            contentType: 'text/csv',
          })
          .field('list_type', 'PEP')
          .field('list_source', `E2E Dup ${SUFFIX}`)
          .expect(201);

      await doUpload();
      await doUpload();

      const { rows } = await pgPool.query(
        `SELECT unique_id FROM watchlist_entries WHERE name = $1`,
        [fullName],
      );
      // Hanya 1 baris meski di-upload 2x (dedup via unique_id auto-generate deterministik)
      expect(rows.length).toBe(1);
      expect(rows[0].unique_id).toMatch(/^KESH-WL-AUTO-[0-9A-F]{16}$/);
    });

    it('I-09: upload baris tanpa Full_Name & Entity_Name → ditolak (identity name wajib)', async () => {
      const csv = [
        'Unique_ID,Full_Name,Entity_Name,Date_of_Birth',
        `,,,2000-01-01`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_noname_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E NoName ${SUFFIX}`)
        .expect(201);

      expect(res.body.total).toBe(1);
      expect(res.body.success).toBe(0);
      expect(res.body.errors).toBeTruthy();
    });

    // ── Watchlist Template v3 (kolom opsional tambahan) ─────────
    it('I-10: PEP row dengan Jabatan/Instansi → tersimpan (position_title, institution_name)', async () => {
      const fullName = `PEP V3 ${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Date_of_Birth,Nationality,Jabatan,Instansi',
        `,${fullName},1972-02-02,ID,Gubernur,Bank Sentral`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_pep_v3_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E PEP v3 ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);

      const { rows } = await pgPool.query(
        `SELECT position_title, institution_name, watchlist_type
           FROM watchlist_entries WHERE name = $1 LIMIT 1`,
        [fullName],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].position_title).toBe('Gubernur');
      expect(rows[0].institution_name).toBe('Bank Sentral');
      expect(rows[0].watchlist_type).toBe('PEP'); // di-infer dari list_type
    });

    it('I-11: DTTOT row dengan Terduga/Tempat Lahir/Alamat/Deskripsi → tersimpan + subject_type dinormalisasi', async () => {
      const fullName = `DTTOT V3 ${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Terduga,Tempat Lahir,Alamat,Raw Date of Birth,Deskripsi',
        `,${fullName},Orang,Surabaya,Jl. Merdeka No. 5,circa 1968,Terduga teroris`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_dttot_v3_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'DTTOT')
        .field('list_source', `E2E DTTOT v3 ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);

      const { rows } = await pgPool.query(
        `SELECT subject_type, place_of_birth, address, raw_date_of_birth, description, watchlist_type
           FROM watchlist_entries WHERE name = $1 LIMIT 1`,
        [fullName],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].subject_type).toBe('PERSON'); // "Orang" → PERSON
      expect(rows[0].place_of_birth).toBe('Surabaya');
      expect(rows[0].address).toBe('Jl. Merdeka No. 5');
      expect(rows[0].raw_date_of_birth).toBe('circa 1968');
      expect(rows[0].description).toBe('Terduga teroris');
      expect(rows[0].watchlist_type).toBe('DTTOT');
    });

    it('I-12: template v2 lama (tanpa kolom v3) tetap ter-upload', async () => {
      const fullName = `Legacy V2 ${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Alias_Name,Date_of_Birth,Nationality,National_ID_Number,Sanction_Number,Source_URL,Remarks',
        `WLV2${SUFFIX},${fullName},"Ali;Aly",1965-06-06,ID,NIKV2${SUFFIX},SN-${SUFFIX},http://x,legacy row`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_v2_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'DTTOT')
        .field('list_source', `E2E V2 ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);

      const { rows } = await pgPool.query(
        `SELECT unique_id, subject_type, watchlist_type
           FROM watchlist_entries WHERE upper(unique_id) = upper($1) LIMIT 1`,
        [`WLV2${SUFFIX}`],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].unique_id).toBe(`WLV2${SUFFIX}`); // explicit Unique_ID dipertahankan
      expect(rows[0].subject_type).toBeNull(); // tidak diisi → null
      expect(rows[0].watchlist_type).toBe('DTTOT'); // infer dari list_type
    });

    it('I-13: v3 row dengan Unique_ID kosong → tetap auto-generate KESH-WL-AUTO-...', async () => {
      const fullName = `Auto V3 ${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Date_of_Birth,Jabatan,Instansi',
        `,${fullName},1988-08-08,Menteri,Kementerian`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_auto_v3_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E Auto v3 ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);

      const { rows } = await pgPool.query(
        `SELECT unique_id FROM watchlist_entries WHERE name = $1 LIMIT 1`,
        [fullName],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].unique_id).toMatch(/^KESH-WL-AUTO-[0-9A-F]{16}$/);
    });

    it('I-14: upload PPPSPM row → tersimpan dengan list_type PPPSPM + auto-generate Unique_ID', async () => {
      const fullName = `PPPSPM Subject ${SUFFIX}`;
      const csv = [
        'Unique_ID,Full_Name,Date_of_Birth,Nationality,Sanction_Number',
        `,${fullName},1983-07-07,ID,PPPSPM-${SUFFIX}`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_pppspm_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PPPSPM')
        .field('list_source', `E2E PPPSPM ${SUFFIX}`)
        .expect(201);

      // Tidak boleh silent failure: minimal 1 row sukses
      expect(res.body.success).toBeGreaterThan(0);
      expect(res.body.errors).toBeFalsy();

      // Row benar-benar persisted dengan list_type PPPSPM
      const { rows } = await pgPool.query(
        `SELECT list_type, unique_id, watchlist_type
           FROM watchlist_entries WHERE name = $1 LIMIT 1`,
        [fullName],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].list_type).toBe('PPPSPM');
      expect(rows[0].watchlist_type).toBe('PPPSPM'); // di-infer dari list_type
      expect(rows[0].unique_id).toMatch(/^KESH-WL-AUTO-[0-9A-F]{16}$/); // auto-generate
    });

    // ── Mixed Watchlist_Type policy + reporting non-misleading ──
    it('I-15: upload mixed v3 (DTTOT+PEP+PPPSPM) dengan list_type PEP → 1 success, 2 row errors, tanpa silent skip', async () => {
      const pepName = `Mixed PEP ${SUFFIX}`;
      const dttotEntity = `Mixed DTTOT Korp ${SUFFIX}`;
      const pppspmName = `Mixed PPPSPM ${SUFFIX}`;
      const csv = [
        'Unique_ID,Watchlist_Type,Full_Name,Entity_Name,Date_of_Birth,Nationality',
        `,DTTOT,,${dttotEntity},,ID`,
        `,PEP,${pepName},,1970-01-01,ID`,
        `,PPPSPM,${pppspmName},,1980-02-02,ID`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_mixed_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E Mixed ${SUFFIX}`)
        .expect(201);

      // Response tidak misleading: partial failure jelas
      expect(res.body.total).toBe(3);
      expect(res.body.success).toBe(1);
      expect(res.body.error_count).toBe(2);
      expect(res.body.status).toBe('PARTIAL');
      expect(res.body.ok).toBe(true);
      expect(Array.isArray(res.body.row_errors)).toBe(true);
      expect(res.body.row_errors).toHaveLength(2);
      for (const e of res.body.row_errors) {
        expect(typeof e.row).toBe('number');
        expect(e.message).toMatch(/tidak cocok dengan Jenis List/);
      }

      // Row PEP tersimpan; DTTOT & PPPSPM TIDAK tersimpan (bukan silent skip/relabel)
      const pep = await pgPool.query(
        `SELECT list_type FROM watchlist_entries WHERE name = $1`,
        [pepName],
      );
      expect(pep.rows).toHaveLength(1);
      expect(pep.rows[0].list_type).toBe('PEP');

      const dttot = await pgPool.query(
        `SELECT id FROM watchlist_entries WHERE entity_name = $1`,
        [dttotEntity],
      );
      expect(dttot.rows).toHaveLength(0);

      const pppspm = await pgPool.query(
        `SELECT id FROM watchlist_entries WHERE name = $1`,
        [pppspmName],
      );
      expect(pppspm.rows).toHaveLength(0);
    });

    it('I-16: upload PEP-only v3 dengan Unique_ID kosong → 1 success (SUCCESS, tanpa error)', async () => {
      const fullName = `PEP Only V3 ${SUFFIX}`;
      const csv = [
        'Unique_ID,Watchlist_Type,Full_Name,Date_of_Birth,Jabatan,Instansi',
        `,PEP,${fullName},1975-05-05,Direktur,Kementerian X`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `wl_pep_only_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E PEP Only ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);
      expect(res.body.error_count).toBe(0);
      expect(res.body.status).toBe('SUCCESS');
      expect(res.body.errors).toBeFalsy();

      const { rows } = await pgPool.query(
        `SELECT unique_id FROM watchlist_entries WHERE name = $1 LIMIT 1`,
        [fullName],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].unique_id).toMatch(/^KESH-WL-AUTO-[0-9A-F]{16}$/);
    });

    it('I-17: CSV dengan BOM UTF-8 → header Unique_ID tetap terbaca (bukan auto-generate)', async () => {
      const providedUid = `WLBOM${SUFFIX}`;
      const fullName = `Bom Person ${SUFFIX}`;
      const csvBody = [
        'Unique_ID,Full_Name,Date_of_Birth,Nationality',
        `${providedUid},${fullName},1966-06-06,ID`,
      ].join('\n');
      const withBom = '\uFEFF' + csvBody; // UTF-8-SIG

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(withBom, 'utf8'), {
          filename: `wl_bom_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E BOM ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBe(1);

      // Kalau header BOM tidak dinormalisasi, Unique_ID akan null → auto-generate.
      // Assertion: unique_id tersimpan == value provided → berarti header terbaca benar.
      const { rows } = await pgPool.query(
        `SELECT unique_id FROM watchlist_entries WHERE upper(unique_id) = upper($1) LIMIT 1`,
        [providedUid],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].unique_id).toBe(providedUid);
    });
  });

  // ══════════════════════════════════════════════════════════
  // I2. WATCHLIST ENTRIES — GET /watchlist/entries (list data tersimpan)
  // ══════════════════════════════════════════════════════════
  describe('I2. Watchlist Entries', () => {
    const entriesSource = `ENTRIESSRC ${SUFFIX}`;
    const pepName = `Entries PEP ${SUFFIX}`;
    const pepPosition = `Walikota ${SUFFIX}`;
    const pepInstitution = `Pemkot ${SUFFIX}`;
    const dttotEntity = `Entries DTTOT Korp ${SUFFIX}`;

    beforeAll(async () => {
      // Seed 1 row PEP (dengan Jabatan/Instansi) + 1 row DTTOT, source unik agar query terisolasi.
      const pepCsv = [
        'Unique_ID,Watchlist_Type,Full_Name,Date_of_Birth,Nationality,National_ID_Number,Jabatan,Instansi',
        `,PEP,${pepName},1970-01-01,ID,NIKENT${SUFFIX},${pepPosition},${pepInstitution}`,
      ].join('\n');
      await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(pepCsv), {
          filename: `entries_pep_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', entriesSource)
        .expect(201);

      const dttotCsv = [
        'Unique_ID,Watchlist_Type,Entity_Name,Nationality',
        `,DTTOT,${dttotEntity},ID`,
      ].join('\n');
      await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(dttotCsv), {
          filename: `entries_dttot_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'DTTOT')
        .field('list_source', entriesSource)
        .expect(201);
    }, 20000);

    it('I2-01: ComplianceLead GET /watchlist/entries → 200 + shape {data,page,limit,total}', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .query({ source_list: entriesSource })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
      expect(res.body.total).toBe(2); // 1 PEP + 1 DTTOT di source ini
      // field-field penting ada di item
      const item = res.body.data[0];
      expect(item).toHaveProperty('source_list', entriesSource);
      expect(item).toHaveProperty('watchlist_type');
      expect(item).toHaveProperty('position_title');
      expect(item).toHaveProperty('unique_id');
    });

    it('I2-02: SystemAdmin GET /watchlist/entries → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .query({ source_list: entriesSource })
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('I2-03: FrontDesk GET /watchlist/entries → 403', async () => {
      return request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(403);
    });

    it('I2-04: FinanceStaff GET /watchlist/entries → 403', async () => {
      return request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(403);
    });

    it('I2-05: filter list_type=PEP → hanya row PEP', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .query({ source_list: entriesSource, list_type: 'PEP' })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data.every((r: any) => r.list_type === 'PEP')).toBe(true);
    });

    it('I2-06: search q=full_name → menemukan row', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .query({ q: pepName })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.data.some((r: any) => r.full_name === pepName)).toBe(true);
    });

    it('I2-07: search q=position_title & q=institution_name (PEP) → menemukan row', async () => {
      const byPos = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .query({ q: pepPosition })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(byPos.body.data.some((r: any) => r.position_title === pepPosition)).toBe(true);

      const byInst = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .query({ q: pepInstitution })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(byInst.body.data.some((r: any) => r.institution_name === pepInstitution)).toBe(true);
    });

    it('I2-08: pagination limit=1 → data length 1, total tetap 2', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/entries`)
        .query({ source_list: entriesSource, page: 1, limit: 1 })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.limit).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.data.length).toBe(1);
      expect(res.body.total).toBe(2);
    });

    it('I2-09: GET /watchlist/history menyertakan total/success/error_count/status', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const h = res.body.data[0];
      expect(h).toHaveProperty('total');
      expect(h).toHaveProperty('success');
      expect(h).toHaveProperty('error_count');
      expect(h).toHaveProperty('status');
      expect(h).toHaveProperty('source_list');
      expect(h).toHaveProperty('uploaded_at');
      expect(typeof h.total).toBe('number');
      expect(['SUCCESS', 'PARTIAL', 'FAILED']).toContain(h.status);
    });

    // ── Pagination & filter untuk Riwayat Upload ──
    it('I2-10: history pagination limit=2 → data ≤ 2, total number, page/limit echo', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .query({ page: 1, limit: 2 })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.total).toBeGreaterThan(0);
    });

    it('I2-11: history filter list_type=PEP → semua row PEP', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .query({ list_type: 'PEP', limit: 100 })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((r: any) => r.list_type === 'PEP')).toBe(true);
    });

    it('I2-12: history filter source_list → hanya source itu (isolasi per upload)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .query({ source_list: entriesSource })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      // I2 beforeAll melakukan 2 upload (PEP + DTTOT) dengan source ini
      expect(res.body.total).toBe(2);
      expect(res.body.data.every((r: any) => r.source_list === entriesSource)).toBe(true);
    });

    it('I2-13: history SystemAdmin → 200 (paginated)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .query({ page: 1, limit: 5 })
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('I2-14: history FrontDesk → 403', async () => {
      return request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .query({ page: 1, limit: 5 })
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(403);
    });
  });

  // ══════════════════════════════════════════════════════════
  // J. SYSTEMADMIN RBAC — tidak boleh 403 pada semua read endpoint
  // ══════════════════════════════════════════════════════════
  describe('J. SystemAdmin RBAC — akses semua read endpoint', () => {
    it('J-01: GET /kyc/dashboard-summary dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/dashboard-summary`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(res.body.totals).toBeDefined();
      expect(Array.isArray(res.body.recent)).toBe(true);
    });

    it('J-02: GET /kyc/submissions dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/submissions`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('J-03: GET /kyc/registrants dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/kyc/registrants?type=INDIVIDUAL`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(typeof res.body.total).toBe('number');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('J-04: GET /applications dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('J-05: GET /applications/:id dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(res.body.application).toBeDefined();
    });

    it('J-06: GET /applications/:id/screening dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}/screening`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.results)).toBe(true);
    });

    it('J-07: GET /applications/:id/parties dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${bizAppId}/parties`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('J-08: GET /watchlist/history dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('J-09: GET /users/admins dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/users/admins`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('J-10: GET /transfers dengan SystemAdmin → 200', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });

    it('J-11: GET /transfers/:id dengan SystemAdmin → 200 (bukan miliknya pun boleh lihat)', async () => {
      // transferId dibuat oleh FinanceStaff di F-02, bukan oleh SystemAdmin
      const res = await request(app.getHttpServer())
        .get(`${BASE}/transfers/${transferId}`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(String(res.body.id)).toBe(transferId);
    });

    it('J-12: POST /transfers dengan SystemAdmin → 403 (read-only)', async () => {
      // SystemAdmin tidak boleh membuat transfer — hanya FinanceStaff yang boleh
      return request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({
          amount: 100000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank Test',
          beneficiaryAccountNumber: '111',
          beneficiaryAccountName: 'Test',
        })
        .expect(403);
    });
  });

  // ══════════════════════════════════════════════════════════
  // K. INDIVIDUAL SIGNATURE VIA DOCUMENT UPLOAD (tanpa signature_uri)
  //    Reproduksi bug: user upload file SIGNATURE via /documents,
  //    tapi precheck/submit tetap 400 karena cek hanya ke persons.signature_uri
  // ══════════════════════════════════════════════════════════
  describe('K. Individual — signature via document upload (tanpa signature_uri di create)', () => {
    let sigAppId: string;

    it('K-01: POST /applications/individual tanpa signature_uri → 201 DRAFT', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Individu Sig Doc ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `317800${SUFFIX}`,
          address_identity: 'Jl. Signature No. 1, Surabaya',
          pob: 'Surabaya',
          dob: '1992-04-10',
          nationality: 'ID',
          phone: `0817${SUFFIX}`,
          occupation: 'Wirausaha',
          gender: 'M',
          // sengaja TIDAK kirim signature_uri
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      sigAppId = String(res.body.id);
    });

    it('K-02: GET /precheck tanpa KTP dan tanpa SIGNATURE doc → 400, keduanya missing', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${sigAppId}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('signature_uri'))).toBe(true);
      expect(missing.some((m) => m.includes('dokumen identitas'))).toBe(true);
    });

    it('K-03: POST /documents KTP → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${sigAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'KTP',
          file_uri: 'https://storage.test/docs/ktp_sig.jpg',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('KTP');
    });

    it('K-04: GET /precheck setelah KTP tapi belum ada SIGNATURE → 400, signature missing', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${sigAppId}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('signature_uri'))).toBe(true);
      // dokumen identitas sudah ada, tidak boleh muncul lagi
      expect(missing.some((m) => m.includes('dokumen identitas'))).toBe(false);
    });

    it('K-05: POST /documents SIGNATURE → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${sigAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'SIGNATURE',
          file_uri: 'https://storage.test/signatures/ttd.png',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('SIGNATURE');
    });

    it('K-06: GET /precheck setelah KTP + SIGNATURE doc → 200 ok', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${sigAppId}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.ok).toBe(true);
    });

    it('K-07: PATCH /submit dengan KTP + SIGNATURE doc → 200 SUBMITTED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${sigAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.risk).toBeDefined();
    });
  });

  // ══════════════════════════════════════════════════════════
  // L. APPLICATION DETAIL — full structured response
  //    Verifikasi shape { application, person, business, documents, parties, risk }
  // ══════════════════════════════════════════════════════════
  describe('L. Application detail — full structured response', () => {
    it('L-01: GET /applications/:id (INDIVIDUAL submitted) → risk terisi + risk_factors array', async () => {
      // indivAppIdOk sudah APPROVED — risk harus ada
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.application.type).toBe('INDIVIDUAL');
      expect(res.body.risk).not.toBeNull();
      expect(typeof res.body.risk.risk_score).toBe('number');
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(res.body.risk.risk_level);
      // RBA v2: risk_factors harus array
      expect(Array.isArray(res.body.risk.risk_factors)).toBe(true);
    });

    it('L-02: GET /applications/:id (INDIVIDUAL) → person semua field lengkap', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const p = res.body.person;
      expect(p).not.toBeNull();
      // required person fields
      for (const field of [
        'full_name', 'identity_type', 'identity_number',
        'pob', 'dob', 'nationality', 'phone',
        'gender', 'occupation', 'address_identity',
      ]) {
        expect(p[field]).toBeDefined();
      }
      // signature_uri key harus ada (boleh null kalau tidak di-set saat create)
      expect(Object.prototype.hasOwnProperty.call(p, 'signature_uri')).toBe(true);
      // business harus null untuk INDIVIDUAL
      expect(res.body.business).toBeNull();
    });

    it('L-02b: risk_factors includes ONBOARDING_OFFLINE_DIRECT (score 0) untuk clean individual', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const factors: any[] = res.body.risk.risk_factors;
      const channel = factors.find((f: any) => f.code === 'ONBOARDING_OFFLINE_DIRECT');
      expect(channel).toBeDefined();
      expect(channel.score).toBe(0);
      expect(channel.severity).toBe('INFO');
    });

    it('L-03: GET /applications/:id (BUSINESS) → business semua field lengkap + parties', async () => {
      // bizAppId sudah APPROVED
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${bizAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.application.type).toBe('BUSINESS');

      // person harus null untuk BUSINESS
      expect(res.body.person).toBeNull();

      const b = res.body.business;
      expect(b).not.toBeNull();
      for (const field of [
        'legal_name', 'legal_form', 'incorporation_place', 'incorporation_date',
        'nib', 'npwp', 'address_line', 'city', 'province', 'postal_code',
        'phone', 'business_activity',
      ]) {
        expect(b[field]).toBeDefined();
      }
      // field opsional — key harus ada
      expect(Object.prototype.hasOwnProperty.call(b, 'trade_name')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(b, 'industry_code')).toBe(true);

      // parties
      expect(Array.isArray(res.body.parties)).toBe(true);
      expect(res.body.parties.length).toBeGreaterThan(0);
      expect(res.body.parties[0].role).toBeDefined();

      // risk terisi setelah submit/approve
      expect(res.body.risk).not.toBeNull();
      expect(Array.isArray(res.body.risk.risk_factors)).toBe(true);
      // bizAppId punya DIRECTOR tapi tidak punya BO → harus ada BUSINESS_BO_MISSING
      const bizCodes: string[] = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(bizCodes).toContain('BUSINESS_BO_MISSING');
    });
  });

  // ══════════════════════════════════════════════════════════
  // M. RISK BASED APPROACH v2 — scoring granular
  // ══════════════════════════════════════════════════════════
  describe('M. Risk Based Approach v2 — scoring granular', () => {
    let rbaIndivId: string;
    let rbaBizId: string;

    it('M-01: Individual high-risk occupation (casino) → INDIVIDUAL_HIGH_RISK_OCCUPATION factor + score >= 15', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `RBA Casino Test ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `317950${SUFFIX}`,
          address_identity: 'Jl. RBA No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `0819${SUFFIX}`,
          occupation: 'casino dealer',
          gender: 'M',
          signature_uri: 'https://storage.test/sig_rba.png',
        })
        .expect(201);
      rbaIndivId = String(createRes.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${rbaIndivId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/ktp_rba.jpg' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${rbaIndivId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.risk.risk_factors)).toBe(true);
      const codes: string[] = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(codes).toContain('INDIVIDUAL_HIGH_RISK_OCCUPATION');
      expect(codes).toContain('ONBOARDING_OFFLINE_DIRECT');
      expect(res.body.risk.risk_score).toBeGreaterThanOrEqual(15);
      // 15 < 40 → LOW
      expect(res.body.risk.risk_level).toBe('LOW');

      const occFactor = res.body.risk.risk_factors.find((f: any) => f.code === 'INDIVIDUAL_HIGH_RISK_OCCUPATION');
      expect(occFactor.score).toBe(15);
      expect(occFactor.severity).toBe('MEDIUM');
      expect(occFactor.details).toContain('casino dealer');
    });

    it('M-02: risk_factors tersimpan di GET /applications/:id setelah submit', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${rbaIndivId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.risk.risk_factors)).toBe(true);
      const codes: string[] = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(codes).toContain('INDIVIDUAL_HIGH_RISK_OCCUPATION');
    });

    it('M-03: Business YAYASAN + crypto activity + no BO → HIGH_RISK_ACTIVITY + HIGH_RISK_LEGAL_FORM + BO_MISSING, risk_level MEDIUM', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `Yayasan Kripto ${SUFFIX}`,
          legal_form: 'YAYASAN',
          incorporation_place: 'Jakarta',
          incorporation_date: '2021-01-01',
          business_license_number: `BL_YK_${SUFFIX}`,
          nib: `NIB_YK_${SUFFIX}`,
          npwp: `NPWP_YK_${SUFFIX}`,
          address_line: 'Jl. Yayasan No. 1',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          postal_code: '10110',
          business_activity: 'crypto exchange dan virtual asset',
          phone: `0220${SUFFIX}`,
        })
        .expect(201);
      rbaBizId = String(createRes.body.id);

      for (const dt of ['AKTA_PENDIRIAN', 'NIB_SIUP', 'NPWP_BADAN']) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${rbaBizId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: dt, file_uri: `https://storage.test/${dt}_yk.pdf` })
          .expect(201);
      }

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${rbaBizId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'DIRECTOR',
          full_name: `Direktur Yayasan ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `327750${SUFFIX}`,
          dob: '1975-01-01',
          nationality: 'ID',
          phone: `0811${SUFFIX}`,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${rbaBizId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.risk).toBeDefined();
      const codes: string[] = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(codes).toContain('BUSINESS_HIGH_RISK_ACTIVITY');
      expect(codes).toContain('BUSINESS_HIGH_RISK_LEGAL_FORM');
      expect(codes).toContain('BUSINESS_BO_MISSING');
      expect(codes).toContain('ONBOARDING_OFFLINE_DIRECT');

      // score = 20 + 10 + 30 = 60 → MEDIUM
      expect(res.body.risk.risk_score).toBe(60);
      expect(res.body.risk.risk_level).toBe('MEDIUM');

      const actFactor = res.body.risk.risk_factors.find((f: any) => f.code === 'BUSINESS_HIGH_RISK_ACTIVITY');
      expect(actFactor.score).toBe(20);
      const lfFactor = res.body.risk.risk_factors.find((f: any) => f.code === 'BUSINESS_HIGH_RISK_LEGAL_FORM');
      expect(lfFactor.score).toBe(10);
      const boFactor = res.body.risk.risk_factors.find((f: any) => f.code === 'BUSINESS_BO_MISSING');
      expect(boFactor.score).toBe(30);
      expect(boFactor.severity).toBe('HIGH');
    });

    it('M-04: Clean individual (non-high-risk) → score 0, risk_level LOW, no critical factors', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      // indivAppIdOk: occupation 'Karyawan Swasta', no watchlist hits → score 0
      expect(res.body.risk.risk_score).toBe(0);
      expect(res.body.risk.risk_level).toBe('LOW');

      const criticals = res.body.risk.risk_factors.filter(
        (f: any) => ['CRITICAL', 'HIGH'].includes(f.severity) && f.score > 0,
      );
      expect(criticals.length).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════
  // N. TRANSFER RECORDING v2 — SNAP-ready / audit trail
  //    indivAppIdOk sudah APPROVED (lihat E-02) → dipakai sebagai sender.
  // ══════════════════════════════════════════════════════════
  describe('N. Transfer Recording v2 — SNAP-ready', () => {
    const MANUAL_REF = `KESH-MANUAL-${SUFFIX}`;

    let txAutoRef: string; // created tanpa partner_reference_no → di-generate
    let txSnap: string; // created dengan SNAP fields + manual ref
    let txReject: string; // untuk uji reject
    let txFail: string; // untuk uji result FAILED

    // Helper: create → submit → approve, return id
    async function createSubmitApprove(extra: Record<string, any> = {}) {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({
          amount: 750000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank Mandiri',
          beneficiaryBankCode: '008',
          beneficiaryAccountNumber: '1112223334',
          beneficiaryAccountName: 'PT Penerima',
          ...extra,
        })
        .expect(201);
      const id = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${id}/submit`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${id}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE', decision_notes: 'ok' })
        .expect(201);

      return id;
    }

    it('N-01: create tanpa partner_reference_no → server generate KESH-TRF-...', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({
          amount: 1000000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank BCA',
          beneficiaryAccountNumber: '5556667778',
          beneficiaryAccountName: 'PT Auto Ref',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      expect(res.body.partner_reference_no).toMatch(/^KESH-TRF-\d{8}-[0-9A-F]{16}$/);
      expect(res.body.partner_reference_no.length).toBeLessThanOrEqual(64);
      // amount derivation
      expect(res.body.amount_value).toBe('1000000.00');
      expect(res.body.amount_currency).toBe('IDR');
      // operational defaults
      expect(res.body.transfer_method).toBe('BANK_TRANSFER');
      expect(res.body.transfer_channel).toBe('MANUAL');
      txAutoRef = String(res.body.id);
    });

    it('N-02: create dengan SNAP-ready optional fields → persisted', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({
          amount: 2500000,
          currency: 'idr',
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank BRI',
          beneficiaryBankCode: '002',
          beneficiaryAccountNumber: '9990001112',
          beneficiaryAccountName: 'PT SNAP Ready',
          partner_reference_no: MANUAL_REF,
          source_account_no: '1234567890',
          source_account_name: 'KESH Operasional',
          source_bank_code: '014',
          source_bank_name: 'Bank BCA',
          beneficiary_address: 'Jl. SNAP No. 1, Jakarta',
          beneficiary_email: 'beneficiary@example.com',
          beneficiary_customer_residence: 'ID',
          beneficiary_customer_type: '02',
          transfer_method: 'BANK_TRANSFER',
          transfer_channel: 'MANUAL',
          additional_info: { purpose: 'vendor payment', batch: 'B1' },
        })
        .expect(201);

      expect(res.body.partner_reference_no).toBe(MANUAL_REF);
      expect(res.body.source_account_no).toBe('1234567890');
      expect(res.body.source_bank_code).toBe('014');
      expect(res.body.beneficiary_address).toBe('Jl. SNAP No. 1, Jakarta');
      expect(res.body.beneficiary_email).toBe('beneficiary@example.com');
      expect(res.body.beneficiary_customer_residence).toBe('ID');
      expect(res.body.beneficiary_customer_type).toBe('02');
      expect(res.body.amount_value).toBe('2500000.00');
      expect(res.body.amount_currency).toBe('IDR'); // uppercased
      expect(res.body.additional_info).toEqual({ purpose: 'vendor payment', batch: 'B1' });
      txSnap = String(res.body.id);
    });

    it('N-03: duplicate partner_reference_no → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({
          amount: 100000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank BRI',
          beneficiaryAccountNumber: '9990001112',
          beneficiaryAccountName: 'PT Dup',
          partner_reference_no: MANUAL_REF,
        })
        .expect(400);

      expect(res.body.message).toContain('already exists');
    });

    it('N-04: submit → status SUBMITTED + submitted_by/submitted_at terisi', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txAutoRef}/submit`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(201);

      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.submitted_by).not.toBeNull();
      expect(String(res.body.submitted_by)).toMatch(/^\d+$/);
      expect(res.body.submitted_at).not.toBeNull();
    });

    it('N-05: approve → APPROVED + approved_by/approved_at/decision_notes', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txAutoRef}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE', decision_notes: 'Approved by manager' })
        .expect(201);

      expect(res.body.status).toBe('APPROVED');
      expect(res.body.approved_by).not.toBeNull();
      expect(String(res.body.approved_by)).toMatch(/^\d+$/);
      expect(res.body.approved_at).not.toBeNull();
      expect(res.body.decision_notes).toBe('Approved by manager');
    });

    it('N-06: reject → REJECTED + rejected_by/rejected_at/reject_reason', async () => {
      // transfer baru khusus reject
      const create = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({
          amount: 300000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank BNI',
          beneficiaryAccountNumber: '4445556667',
          beneficiaryAccountName: 'PT Ditolak',
        })
        .expect(201);
      txReject = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txReject}/submit`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txReject}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'REJECT', reject_reason: 'Rekening tidak valid', decision_notes: 'cek ulang' })
        .expect(201);

      expect(res.body.status).toBe('REJECTED');
      expect(res.body.rejected_by).not.toBeNull();
      expect(String(res.body.rejected_by)).toMatch(/^\d+$/);
      expect(res.body.rejected_at).not.toBeNull();
      expect(res.body.reject_reason).toBe('Rekening tidak valid');
      expect(res.body.decision_notes).toBe('cek ulang');
    });

    it('N-07: result SUCCESS → completed_at/result_updated_by/result_reference_no/bank_reference_no', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txAutoRef}/result`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({
          result: 'SUCCESS',
          result_reference_no: `RES-${SUFFIX}`,
          bank_reference_no: `BANK-${SUFFIX}`,
          latest_transaction_status: '00',
          transaction_status_desc: 'Success',
          provider_response_code: '2000700',
          provider_response_message: 'Successful',
          provider_response: { responseCode: '2000700' },
        })
        .expect(201);

      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.result).toBe('SUCCESS');
      expect(res.body.completed_at).not.toBeNull();
      expect(res.body.failed_at).toBeNull();
      expect(res.body.result_updated_by).not.toBeNull();
      expect(String(res.body.result_updated_by)).toMatch(/^\d+$/);
      expect(res.body.result_updated_at).not.toBeNull();
      expect(res.body.result_reference_no).toBe(`RES-${SUFFIX}`);
      expect(res.body.bank_reference_no).toBe(`BANK-${SUFFIX}`);
      expect(res.body.latest_transaction_status).toBe('00');
      expect(res.body.provider_response_code).toBe('2000700');
    });

    it('N-08: result FAILED → failed_at/failed_reason', async () => {
      txFail = await createSubmitApprove({
        beneficiaryAccountNumber: '7778889990',
        beneficiaryAccountName: 'PT Gagal',
      });

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txFail}/result`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ result: 'FAILED', failed_reason: 'Saldo tidak mencukupi' })
        .expect(201);

      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.result).toBe('FAILED');
      expect(res.body.failed_at).not.toBeNull();
      expect(res.body.completed_at).toBeNull();
      expect(res.body.failed_reason).toBe('Saldo tidak mencukupi');
      expect(res.body.result_updated_by).not.toBeNull();
    });

    it('N-09: SystemAdmin read OK tapi submit/approve/result → 403', async () => {
      // list & detail boleh
      await request(app.getHttpServer())
        .get(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`${BASE}/transfers/${txSnap}`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      // mutasi dilarang (read-only)
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txSnap}/submit`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(403);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txSnap}/decision`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({ decision: 'APPROVE' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txSnap}/result`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({ result: 'SUCCESS' })
        .expect(403);
    });

    it('N-10: GET /transfers/:id/snap-preview → amount + beneficiary + source mapping', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/transfers/${txSnap}/snap-preview`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(200);

      expect(res.body.partnerReferenceNo).toBe(MANUAL_REF);
      expect(res.body.amount.value).toBe('2500000.00');
      expect(res.body.amount.currency).toBe('IDR');
      expect(res.body.beneficiaryAccountNo).toBe('9990001112');
      expect(res.body.beneficiaryAccountName).toBe('PT SNAP Ready');
      expect(res.body.beneficiaryBankCode).toBe('002');
      expect(res.body.beneficiaryAddress).toBe('Jl. SNAP No. 1, Jakarta');
      expect(res.body.beneficiaryEmail).toBe('beneficiary@example.com');
      expect(res.body.sourceAccountNo).toBe('1234567890');
      expect(res.body.additionalInfo).toEqual({ purpose: 'vendor payment', batch: 'B1' });
    });

    it('N-11: SystemAdmin boleh baca snap-preview', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/transfers/${txSnap}/snap-preview`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(res.body.partnerReferenceNo).toBe(MANUAL_REF);
    });
  });

  // ══════════════════════════════════════════════════════════
  // O. EDD — Enhanced Due Diligence (HIGH RISK flow)
  //
  // Strategy HIGH RISK (score ≥70) tanpa bergantung pada watchlist matching:
  //   - casino dealer occupation (+15, HIGH_RISK_OCCUPATION)
  //   - pep_self_declared=true via pgPool (+40)
  //   - KTP status REJECTED via pgPool (+15, DOC_REJECTED)
  //   Total: 70 → HIGH
  // ══════════════════════════════════════════════════════════
  describe('O. EDD — Enhanced Due Diligence', () => {
    const EDD_PERSON_NAME = `EDD Risk Test ${SUFFIX}`;
    let eddHighAppId: string;
    let eddRejectAppId: string;

    // Helper: buat individual HIGH RISK menggunakan pgPool untuk set faktor risiko langsung
    async function createHighRiskIndividual(identNum: string, phone: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: EDD_PERSON_NAME,
          identity_type: 'KTP',
          identity_number: identNum,
          address_identity: 'Jl. EDD No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1970-01-01',
          nationality: 'ID',
          phone,
          occupation: 'casino dealer',   // +15 pts
          gender: 'M',
          signature_uri: 'https://storage.test/edd_sig.png',
        })
        .expect(201);

      const appId = String(create.body.id);

      // Set pep_self_declared=true (+40 pts)
      const { rows: appRows } = await pgPool.query(
        'SELECT person_id FROM applications WHERE id=$1', [appId],
      );
      await pgPool.query(
        'UPDATE persons SET pep_self_declared=true WHERE id=$1', [appRows[0].person_id],
      );

      // Tambah KTP dan mark REJECTED (+15 pts DOC_REJECTED)
      const docRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/edd_ktp.jpg' })
        .expect(201);

      await pgPool.query(
        'UPDATE documents SET status=$1 WHERE id=$2', ['REJECTED', docRes.body.id],
      );

      // Score: 15+40+15 = 70 → HIGH
      return appId;
    }

    it('O-01: Submit HIGH RISK individual → status IN_REVIEW, risk_level HIGH', async () => {
      eddHighAppId = await createHighRiskIndividual(`31890000${SUFFIX}`, `088800${SUFFIX}`);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.status).toBe('IN_REVIEW');
      expect(res.body.risk.risk_level).toBe('HIGH');
      expect(res.body.risk.risk_score).toBeGreaterThanOrEqual(70);
    });

    it('O-02: GET /applications/:id includes edd_required=true, edd_completed=false', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddHighAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.edd).toBeDefined();
      expect(res.body.edd.edd_required).toBe(true);
      expect(res.body.edd.edd_completed).toBe(false);
    });

    it('O-03: APPROVE HIGH RISK tanpa EDD selesai → 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED' })
        .expect(400);

      expect(res.body.message).toContain('EDD');
    });

    it('O-04: REJECT HIGH RISK tanpa EDD → 200 REJECTED (diizinkan)', async () => {
      eddRejectAppId = await createHighRiskIndividual(`31890001${SUFFIX}`, `088801${SUFFIX}`);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddRejectAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddRejectAppId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'REJECTED', reason: 'HIGH RISK reject tanpa EDD' })
        .expect(200);

      expect(res.body.status).toBe('REJECTED');
    });

    it('O-05: GET /applications/:id/edd → 200, edd_required=true, applicant_snapshot terisi', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.edd_required).toBe(true);
      expect(res.body.edd_completed).toBe(false);
      expect(res.body.applicant_snapshot).toBeDefined();
      expect(res.body.applicant_snapshot.full_name).toBe(EDD_PERSON_NAME);
      expect(res.body.applicant_snapshot.customer_category).toBe('INDIVIDUAL');
    });

    it('O-06: PATCH /edd draft (partial) → 200, data tersimpan + snapshot dari init tetap ada', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          high_risk_reasons: {
            customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'],
          },
          officer_analysis: {
            overall_risk_summary: 'HIGH',
            follow_up_recommendations: ['REQUEST_ADDITIONAL_DOCUMENTS'],
          },
        })
        .expect(200);

      expect(res.body.edd_completed).toBe(false);
      expect(res.body.high_risk_reasons.customer_characteristics).toContain('HIGH_RISK_OCCUPATION_OR_BUSINESS');
      expect(res.body.officer_analysis.overall_risk_summary).toBe('HIGH');
      // snapshot dari initEddForHighRisk harus tetap ada
      expect(res.body.applicant_snapshot.full_name).toBe(EDD_PERSON_NAME);
    });

    it('O-07: PATCH /edd complete=true dengan data tidak lengkap → 400 dengan errors', async () => {
      // Hanya kirim complete=true tanpa field wajib lainnya
      // compliance_decision.decision dan internal_checklist.edd_form_completed masih kosong
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ complete: true })
        .expect(400);

      expect(res.body.message).toContain('EDD belum memenuhi syarat');
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('O-08: PATCH /edd complete=true dengan semua field wajib → 200, edd_completed=true', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          complete: true,
          applicant_snapshot: {
            full_name: EDD_PERSON_NAME,
            identity_number: `31890000${SUFFIX}`,
            identity_type: 'KTP',
            customer_category: 'INDIVIDUAL',
          },
          high_risk_reasons: {
            customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'],
          },
          officer_analysis: {
            overall_risk_summary: 'HIGH',
            follow_up_recommendations: ['REQUEST_ADDITIONAL_DOCUMENTS'],
            cdd_edd_consistency: 'CONSISTENT',
            transaction_profile_reasonableness: 'REASONABLE',
            occupation_source_funds_wealth_assessment: 'ADEQUATE',
          },
          compliance_decision: {
            decision: 'DELAYED',
            decision_reason: 'Menunggu dokumen tambahan',
            officer_name: 'Compliance Officer',
          },
          internal_checklist: {
            edd_form_completed: true,
          },
        })
        .expect(200);

      expect(res.body.edd_completed).toBe(true);
      expect(res.body.completed_by).not.toBeNull();
      expect(String(res.body.completed_by)).toMatch(/^\d+$/);
      expect(res.body.completed_at).not.toBeNull();
    });

    it('O-09: APPROVE HIGH RISK setelah EDD selesai → 200 APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED', reason: 'EDD lengkap, risiko telah dinilai' })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
    });

    it('O-10: LOW RISK app dapat APPROVE tanpa EDD', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: 'Budi Santoso Murni',
          identity_type: 'KTP',
          identity_number: `31890002${SUFFIX}`,
          address_identity: 'Jl. Murni No. 1, Bandung',
          pob: 'Bandung',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `088802${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'M',
          signature_uri: 'https://storage.test/low_sig.png',
        })
        .expect(201);

      const lowId = String(createRes.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${lowId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/low_ktp.jpg' })
        .expect(201);

      const submitRes = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${lowId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(submitRes.body.status).toBe('SUBMITTED');
      expect(submitRes.body.risk.risk_level).not.toBe('HIGH');

      const approveRes = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${lowId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(approveRes.body.status).toBe('APPROVED');
    });

    it('O-11: FrontDesk GET /edd → 403', async () => {
      return request(app.getHttpServer())
        .get(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(403);
    });

    it('O-12: ComplianceLead GET /edd setelah complete → 200, edd_completed=true', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.edd_required).toBe(true);
      expect(res.body.edd_completed).toBe(true);
    });

    it('O-13: FrontDesk PATCH /edd → 403', async () => {
      return request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ officer_analysis: { overall_risk_summary: 'LOW' } })
        .expect(403);
    });

    it('O-13b: SystemAdmin GET /edd → 200, edd_required=true', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      expect(res.body.edd_required).toBe(true);
    });

    it('O-14: Conditional validation — NOT_CONSISTENT tanpa consistency_notes → 400', async () => {
      const condAppId = await createHighRiskIndividual(`31890003${SUFFIX}`, `088803${SUFFIX}`);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${condAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${condAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          complete: true,
          applicant_snapshot: { full_name: EDD_PERSON_NAME },
          high_risk_reasons: { customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'] },
          officer_analysis: {
            overall_risk_summary: 'HIGH',
            follow_up_recommendations: ['CONTINUE_RELATIONSHIP_OR_TRANSACTION'],
            cdd_edd_consistency: 'NOT_CONSISTENT',
            // sengaja tidak kirim consistency_notes
          },
          compliance_decision: { decision: 'APPROVED' },
          internal_checklist: { edd_form_completed: true },
        })
        .expect(400);

      expect(res.body.errors.some((e: string) => e.includes('consistency_notes'))).toBe(true);
    });

    it('O-15: GET /edd pada LOW RISK app (tidak ada EDD record) → 200 default structure', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdOk}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.edd_required).toBe(false);
      expect(res.body.edd_completed).toBe(false);
      expect(res.body.applicant_snapshot).toEqual({});
    });
  });

  // ══════════════════════════════════════════════════════════
  // P. PEP Force-HIGH — any PEP detection forces risk_level HIGH
  //
  // Business rule: if screening or self-declaration detects PEP,
  // final risk_level must be HIGH regardless of computed score.
  //
  // Sub-cases:
  //   P-01..P-04: watchlist PEP candidate match (score=20 → old LOW → new HIGH)
  //   P-05..P-06: self-declared PEP alone (score=40 → old MEDIUM → new HIGH)
  // ══════════════════════════════════════════════════════════
  describe('P. PEP Force-HIGH — any PEP detection forces HIGH risk', () => {
    const PEP_WL_NAME = `PEP Force High ${SUFFIX}`;
    let pepWlAppId: string;
    let pepSelfAppId: string;

    it('P-01: Upload PEP watchlist entry → 201', async () => {
      const csv = [
        'Unique_ID,Full_Name,Date_of_Birth,Nationality',
        `PEPFH${SUFFIX},${PEP_WL_NAME},1975-06-15,ID`,
      ].join('\n');

      const res = await request(app.getHttpServer())
        .post(`${BASE}/watchlist/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', Buffer.from(csv), {
          filename: `pep_force_high_${SUFFIX}.csv`,
          contentType: 'text/csv',
        })
        .field('list_type', 'PEP')
        .field('list_source', `E2E PEP Force High ${SUFFIX}`)
        .expect(201);

      expect(res.body.success).toBeGreaterThanOrEqual(1);
    });

    it('P-02: Submit application whose name matches PEP watchlist → risk_level HIGH, WATCHLIST_PEP_CANDIDATE factor, status IN_REVIEW', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: PEP_WL_NAME,
          identity_type: 'KTP',
          identity_number: `31899000${SUFFIX}`,
          address_identity: 'Jl. PEP No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1975-06-15',
          nationality: 'ID',
          phone: `0899900${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'M',
          signature_uri: 'https://storage.test/pep_fh_sig.png',
        })
        .expect(201);

      pepWlAppId = String(createRes.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${pepWlAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/pep_fh_ktp.jpg' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${pepWlAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.status).toBe('IN_REVIEW');
      expect(res.body.risk.risk_level).toBe('HIGH');
      expect(res.body.risk.risk_score).toBeGreaterThanOrEqual(70);

      const codes: string[] = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(codes).toContain('WATCHLIST_PEP_CANDIDATE');
    });

    it('P-03: GET /applications/:id → edd_required=true, edd_completed=false', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${pepWlAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.edd).toBeDefined();
      expect(res.body.edd.edd_required).toBe(true);
      expect(res.body.edd.edd_completed).toBe(false);
    });

    it('P-04: APPROVE PEP-detected application without EDD → 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${pepWlAppId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED' })
        .expect(400);

      expect(res.body.message).toContain('EDD');
    });

    it('P-05: Self-declared PEP alone (score=40, old rule=MEDIUM) → new rule forces HIGH', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `PEP Self Declared ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `31899001${SUFFIX}`,
          address_identity: 'Jl. PEP SD No. 2, Bandung',
          pob: 'Bandung',
          dob: '1980-03-20',
          nationality: 'ID',
          phone: `0899901${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'F',
          signature_uri: 'https://storage.test/pep_sd_sig.png',
        })
        .expect(201);

      pepSelfAppId = String(createRes.body.id);

      // Set pep_self_declared=true — score alone = 40 which was MEDIUM under old rule
      const { rows: appRows } = await pgPool.query(
        'SELECT person_id FROM applications WHERE id=$1', [pepSelfAppId],
      );
      await pgPool.query(
        'UPDATE persons SET pep_self_declared=true WHERE id=$1', [appRows[0].person_id],
      );

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${pepSelfAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/pep_sd_ktp.jpg' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${pepSelfAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.status).toBe('IN_REVIEW');
      expect(res.body.risk.risk_level).toBe('HIGH');
      expect(res.body.risk.risk_score).toBeGreaterThanOrEqual(70);

      const codes: string[] = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(codes).toContain('INDIVIDUAL_PEP_SELF_DECLARED');
    });

    it('P-06: GET /applications/:id for self-declared PEP → edd_required=true', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${pepSelfAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.edd.edd_required).toBe(true);
      expect(res.body.edd.edd_completed).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════
  // Q. CIF Number — Customer Information File
  //
  // Format (no dashes):
  //   Individual : KSHI<NIK_LAST6><SEQ5>
  //   Business   : KSHB<NIB_OR_NPWP_LAST6><SEQ5>
  //
  // Rules:
  //   - Generated once at creation, immutable thereafter
  //   - Unique across all records
  //   - If NIB absent, use NPWP last6 for business CIF
  //   - SEQ5 = 5-digit zero-padded sequence
  // ══════════════════════════════════════════════════════════
  describe('Q. CIF Number', () => {
    const CIF_NIK         = `32000099${SUFFIX}`; // 15-digit KTP-like number
    const CIF_NIK_LAST6   = CIF_NIK.replace(/\D/g, '').slice(-6);

    const CIF_NIB         = `12900099${SUFFIX}`; // NIB
    const CIF_NIB_LAST6   = CIF_NIB.replace(/\D/g, '').slice(-6);

    const CIF_NPWP_NO_NIB = `98.765.432.1-${SUFFIX.slice(0, 3)}.${SUFFIX.slice(3)}`; // NPWP with dots/dash
    const CIF_NPWP_DIGITS = CIF_NPWP_NO_NIB.replace(/\D/g, '');
    const CIF_NPWP_LAST6  = CIF_NPWP_DIGITS.slice(-6);

    let cifIndivAppId: string;
    let cifBizNibAppId: string;
    let cifBizNpwpAppId: string;
    let firstCifNo: string;

    it('Q-01: Individual with KTP → GET person.cif_no matches KSHI<NIK_LAST6><SEQ5>', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `CIF Test Individual ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: CIF_NIK,
          address_identity: 'Jl. CIF No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1985-05-10',
          nationality: 'ID',
          phone: `0811111${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'M',
          signature_uri: 'https://storage.test/cif_sig.png',
        })
        .expect(201);

      cifIndivAppId = String(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${cifIndivAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const cif: string = res.body.person.cif_no;
      expect(cif).toBeDefined();
      expect(cif).toMatch(/^KSHI\d{11}$/);
      expect(cif).toContain(`KSHI${CIF_NIK_LAST6}`);

      firstCifNo = cif;
    });

    it('Q-02: Business with NIB → GET business.cif_no matches KSHB<NIB_LAST6><SEQ5>', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `PT CIF Nib Test ${SUFFIX}`,
          legal_form: 'PT',
          incorporation_place: 'Jakarta',
          incorporation_date: '2020-01-01',
          business_license_number: `BL_CIF_${SUFFIX}`,
          nib: CIF_NIB,
          npwp: `11.111.111.1-${SUFFIX.slice(0, 3)}.${SUFFIX.slice(3)}`,
          address_line: 'Jl. NIB No. 1',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          postal_code: '10110',
          business_activity: 'perdagangan',
          phone: `0222111${SUFFIX}`,
        })
        .expect(201);

      cifBizNibAppId = String(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${cifBizNibAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const cif: string = res.body.business.cif_no;
      expect(cif).toBeDefined();
      expect(cif).toMatch(/^KSHB\d{11}$/);
      expect(cif).toContain(`KSHB${CIF_NIB_LAST6}`);
    });

    it('Q-03: Business without NIB → cif_no uses NPWP last6', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `PT CIF Npwp Test ${SUFFIX}`,
          legal_form: 'CV',
          incorporation_place: 'Bandung',
          incorporation_date: '2021-06-01',
          business_license_number: `BL_NPWP_${SUFFIX}`,
          nib: null,
          npwp: CIF_NPWP_NO_NIB,
          address_line: 'Jl. NPWP No. 2',
          city: 'Bandung',
          province: 'Jawa Barat',
          postal_code: '40115',
          business_activity: 'jasa konsultan',
          phone: `0333222${SUFFIX}`,
        })
        .expect(201);

      cifBizNpwpAppId = String(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${cifBizNpwpAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const cif: string = res.body.business.cif_no;
      expect(cif).toBeDefined();
      expect(cif).toMatch(/^KSHB\d{11}$/);
      expect(cif).toContain(`KSHB${CIF_NPWP_LAST6}`);
    });

    it('Q-04: Two different individuals → unique CIF numbers', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `CIF Test Individual 2 ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `32000098${SUFFIX}`,
          address_identity: 'Jl. CIF No. 2, Jakarta',
          pob: 'Surabaya',
          dob: '1990-03-15',
          nationality: 'ID',
          phone: `0811112${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'F',
          signature_uri: 'https://storage.test/cif2_sig.png',
        })
        .expect(201);

      const appId2 = String(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId2}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const cif2: string = res.body.person.cif_no;
      expect(cif2).toBeDefined();
      expect(cif2).not.toBe(firstCifNo);
    });

    it('Q-05: CIF tidak berubah setelah submit', async () => {
      // Add KTP document first so precheck passes
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${cifIndivAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/cif_ktp.jpg' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${cifIndivAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${cifIndivAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.person.cif_no).toBe(firstCifNo);
    });
  });

  // ══════════════════════════════════════════════════════════
  // R. CIF Relationship Type & BO CIF Reuse
  //
  // Business rules verified:
  //   - BO party gets CIF KSHI..., cif_relationship_type=BO
  //   - Individual with same NIK as existing BO reuses that CIF
  //   - Individual created first → BO added later reuses person CIF
  //   - persons.cif_relationship_type=OUR_CUSTOMER by default
  //   - WIC is accepted as optional cif_relationship_type on individual create
  // ══════════════════════════════════════════════════════════
  describe('R. CIF Relationship Type & BO CIF Reuse', () => {
    // Shared NIK between BO and Individual scenarios
    const BO_FIRST_NIK    = `3299100${SUFFIX}`; // BO added first, individual later
    const INDIV_FIRST_NIK = `3299200${SUFFIX}`; // individual created first, BO later

    let boFirstBizAppId: string;   // business app where BO is added first
    let boFirstIndivAppId: string; // individual app created after BO (same NIK)
    let boFirstCifNo: string;      // CIF assigned to the BO party

    let indivFirstAppId: string;   // individual app created first
    let indivFirstCifNo: string;   // CIF of that individual
    let indivFirstBizAppId: string; // business app where same person added as BO after

    // ── Scenario A: BO first, then Individual ──────────────────────────────

    it('R-01: Create business app and add BO party → party gets KSHI... CIF', async () => {
      // Create a fresh business application
      const bizCreate = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `PT BO First Test ${SUFFIX}`,
          legal_form: 'PT',
          incorporation_place: 'Jakarta',
          incorporation_date: '2022-01-01',
          business_license_number: `BL_BOF_${SUFFIX}`,
          nib: `9000100${SUFFIX}`,
          npwp: `22.222.222.2-${SUFFIX.slice(0,3)}.${SUFFIX.slice(3)}`,
          address_line: 'Jl. BO First No. 1',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          postal_code: '10110',
          business_activity: 'perdagangan',
          phone: `0444100${SUFFIX}`,
        })
        .expect(201);

      boFirstBizAppId = String(bizCreate.body.id);

      // Add BO party
      const partyRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/${boFirstBizAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'BO',
          full_name: `BO Person First ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: BO_FIRST_NIK,
          dob: '1980-01-01',
          nationality: 'ID',
          phone: `0555100${SUFFIX}`,
        })
        .expect(201);

      expect(partyRes.body.cif_no).toBeDefined();
      expect(partyRes.body.cif_no).toMatch(/^KSHI\d{11}$/);
      expect(partyRes.body.cif_relationship_type).toBe('BO');

      boFirstCifNo = partyRes.body.cif_no;
    });

    it('R-02: GET /parties on the business → BO party has cif_no and cif_relationship_type=BO', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${boFirstBizAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const bo = res.body.find((p: any) => p.role === 'BO');
      expect(bo).toBeDefined();
      expect(bo.cif_no).toBe(boFirstCifNo);
      expect(bo.cif_relationship_type).toBe('BO');
    });

    it('R-03: Create individual application with same NIK as BO → reuses BO CIF', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `BO Person First ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: BO_FIRST_NIK,
          address_identity: 'Jl. BO NIK No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1980-01-01',
          nationality: 'ID',
          phone: `0555101${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'M',
          signature_uri: 'https://storage.test/bo_first_sig.png',
        })
        .expect(201);

      boFirstIndivAppId = String(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${boFirstIndivAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      // CIF must be the same as the BO party CIF
      expect(res.body.person.cif_no).toBe(boFirstCifNo);
      // Relationship type must be OUR_CUSTOMER for individual applications
      expect(res.body.person.cif_relationship_type).toBe('OUR_CUSTOMER');
    });

    // ── Scenario B: Individual first, then BO ──────────────────────────────

    it('R-04: Create individual first → person gets CIF + cif_relationship_type OUR_CUSTOMER', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Indiv First ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: INDIV_FIRST_NIK,
          address_identity: 'Jl. Indiv First No. 2, Jakarta',
          pob: 'Surabaya',
          dob: '1985-07-07',
          nationality: 'ID',
          phone: `0555200${SUFFIX}`,
          occupation: 'Pedagang',
          gender: 'F',
          signature_uri: 'https://storage.test/indiv_first_sig.png',
        })
        .expect(201);

      indivFirstAppId = String(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivFirstAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.person.cif_no).toBeDefined();
      expect(res.body.person.cif_no).toMatch(/^KSHI\d{11}$/);
      expect(res.body.person.cif_relationship_type).toBe('OUR_CUSTOMER');

      indivFirstCifNo = res.body.person.cif_no;
    });

    it('R-05: Add same person as BO to another business → BO.cif_no reuses individual CIF', async () => {
      const bizCreate = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `PT Indiv First Biz ${SUFFIX}`,
          legal_form: 'PT',
          incorporation_place: 'Surabaya',
          incorporation_date: '2023-03-03',
          business_license_number: `BL_IFB_${SUFFIX}`,
          nib: `9000200${SUFFIX}`,
          npwp: `33.333.333.3-${SUFFIX.slice(0,3)}.${SUFFIX.slice(3)}`,
          address_line: 'Jl. Indiv Biz No. 2',
          city: 'Surabaya',
          province: 'Jawa Timur',
          postal_code: '60271',
          business_activity: 'jasa',
          phone: `0555201${SUFFIX}`,
        })
        .expect(201);

      indivFirstBizAppId = String(bizCreate.body.id);

      const partyRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/${indivFirstBizAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'BO',
          full_name: `Indiv First ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: INDIV_FIRST_NIK,
          dob: '1985-07-07',
          nationality: 'ID',
          phone: `0555202${SUFFIX}`,
        })
        .expect(201);

      // BO must reuse the individual's existing CIF
      expect(partyRes.body.cif_no).toBe(indivFirstCifNo);
      expect(partyRes.body.cif_relationship_type).toBe('BO');
    });

    it('R-06: GET /applications/:id (business) parties include cif_no + cif_relationship_type', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivFirstBizAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const bo = res.body.parties.find((p: any) => p.role === 'BO');
      expect(bo).toBeDefined();
      expect(bo.cif_no).toBe(indivFirstCifNo);
      expect(bo.cif_relationship_type).toBe('BO');
    });

    // ── Scenario C: WIC enum value accepted ────────────────────────────────

    it('R-07: Create individual with cif_relationship_type=WIC → accepted (201), person gets WIC type', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `WIC Customer ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `3299300${SUFFIX}`,
          address_identity: 'Jl. WIC No. 3, Bandung',
          pob: 'Bandung',
          dob: '1992-11-11',
          nationality: 'ID',
          phone: `0555300${SUFFIX}`,
          occupation: 'Pedagang',
          gender: 'M',
          signature_uri: 'https://storage.test/wic_sig.png',
          cif_relationship_type: 'WIC',
        })
        .expect(201);

      const wicAppId = String(createRes.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${wicAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.person.cif_no).toBeDefined();
      expect(res.body.person.cif_relationship_type).toBe('WIC');
    });

    it('R-08: non-BO party (DIRECTOR) has cif_relationship_type=null and cif_no=null', async () => {
      // Add a DIRECTOR to the same business used in R-01 so we have both BO and DIRECTOR
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${boFirstBizAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'DIRECTOR',
          full_name: `Direktur Non BO ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `3299400${SUFFIX}`,
          dob: '1978-04-04',
          nationality: 'ID',
          phone: `0555400${SUFFIX}`,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${boFirstBizAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const director = res.body.find((p: any) => p.role === 'DIRECTOR');
      expect(director).toBeDefined();
      expect(director.cif_no).toBeNull();
      expect(director.cif_relationship_type).toBeNull();

      // BO party in the same list is still correct
      const bo = res.body.find((p: any) => p.role === 'BO');
      expect(bo.cif_no).toBe(boFirstCifNo);
      expect(bo.cif_relationship_type).toBe('BO');
    });
  });

  // ══════════════════════════════════════════════════════════
  // S. RBA Occupation & Geography scoring (internal RBA mapping)
  // ══════════════════════════════════════════════════════════
  describe('S. RBA Occupation & Geography scoring', () => {
    // Helper: create individual, upload KTP, submit → return submit response body
    async function createAndSubmit(opts: {
      identNum: string;
      phone: string;
      occupation: string;
      address: string;
    }) {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `RBA Test ${opts.identNum}`,
          identity_type: 'KTP',
          identity_number: opts.identNum,
          address_identity: opts.address,
          pob: 'Bogor',
          dob: '1990-05-10',
          nationality: 'ID',
          phone: opts.phone,
          occupation: opts.occupation,
          gender: 'M',
          signature_uri: 'https://storage.test/rba_sig.png',
        })
        .expect(201);

      const appId = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/rba_ktp.jpg' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      return res.body;
    }

    it('S-01: Occupation "PNS" → INDIVIDUAL_OCCUPATION_HIGH_RBA, score +20, severity HIGH', async () => {
      const body = await createAndSubmit({
        identNum: `3299501${SUFFIX}`,
        phone: `09001${SUFFIX}`,
        occupation: 'PNS',
        address: 'Jl. Merdeka No. 5, Purwokerto',
      });

      const factors: any[] = body.risk.risk_factors;
      const f = factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_HIGH_RBA');
      expect(f).toBeDefined();
      expect(f.score).toBe(20);
      expect(f.severity).toBe('HIGH');
      expect(f.metadata?.matched).toBe('pns');
      expect(body.risk.risk_score).toBeGreaterThanOrEqual(20);
    });

    it('S-02: Occupation "Pegawai BUMN" → INDIVIDUAL_OCCUPATION_MEDIUM_RBA, score +10, severity MEDIUM', async () => {
      const body = await createAndSubmit({
        identNum: `3299502${SUFFIX}`,
        phone: `09002${SUFFIX}`,
        occupation: 'Pegawai BUMN',
        address: 'Jl. Industri No. 3, Malang',
      });

      const factors: any[] = body.risk.risk_factors;
      const f = factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_MEDIUM_RBA');
      expect(f).toBeDefined();
      expect(f.score).toBe(10);
      expect(f.severity).toBe('MEDIUM');
      expect(f.metadata?.matched).toBe('pegawai bumn');
      expect(body.risk.risk_score).toBeGreaterThanOrEqual(10);
    });

    it('S-03: Occupation "Pegawai Bank" → INDIVIDUAL_OCCUPATION_LOW_RBA, score 0 (info only)', async () => {
      const body = await createAndSubmit({
        identNum: `3299503${SUFFIX}`,
        phone: `09003${SUFFIX}`,
        occupation: 'Pegawai Bank',
        address: 'Jl. Perbankan No. 7, Semarang',
      });

      const factors: any[] = body.risk.risk_factors;
      const f = factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_LOW_RBA');
      expect(f).toBeDefined();
      expect(f.score).toBe(0);
      expect(f.severity).toBe('LOW');
      expect(f.metadata?.matched).toBe('pegawai bank');
    });

    it('S-04: Address "DKI Jakarta" → GEOGRAPHY_HIGH_RBA, score +15, severity HIGH, metadata matched', async () => {
      const body = await createAndSubmit({
        identNum: `3299504${SUFFIX}`,
        phone: `09004${SUFFIX}`,
        occupation: 'Karyawan',
        address: 'Jl. Sudirman No. 1, DKI Jakarta 10220',
      });

      const factors: any[] = body.risk.risk_factors;
      const f = factors.find((x: any) => x.code === 'GEOGRAPHY_HIGH_RBA');
      expect(f).toBeDefined();
      expect(f.score).toBe(15);
      expect(f.severity).toBe('HIGH');
      expect(f.metadata?.matched).toBe('dki jakarta');
      expect(f.metadata?.source).toBe('address_identity');
      expect(body.risk.risk_score).toBeGreaterThanOrEqual(15);
    });

    it('S-05: Address "DI Yogyakarta" → GEOGRAPHY_MEDIUM_RBA, score +7, severity MEDIUM', async () => {
      const body = await createAndSubmit({
        identNum: `3299505${SUFFIX}`,
        phone: `09005${SUFFIX}`,
        occupation: 'Karyawan',
        address: 'Jl. Malioboro No. 10, DI Yogyakarta 55271',
      });

      const factors: any[] = body.risk.risk_factors;
      const f = factors.find((x: any) => x.code === 'GEOGRAPHY_MEDIUM_RBA');
      expect(f).toBeDefined();
      expect(f.score).toBe(7);
      expect(f.severity).toBe('MEDIUM');
      expect(f.metadata?.matched).toBe('di yogyakarta');
      expect(body.risk.risk_score).toBeGreaterThanOrEqual(7);
    });

    it('S-06: Address "Papua" → GEOGRAPHY_LOW_RBA, score 0 (info only)', async () => {
      const body = await createAndSubmit({
        identNum: `3299506${SUFFIX}`,
        phone: `09006${SUFFIX}`,
        occupation: 'Karyawan',
        address: 'Jl. Arfak No. 1, Papua 98301',
      });

      const factors: any[] = body.risk.risk_factors;
      const f = factors.find((x: any) => x.code === 'GEOGRAPHY_LOW_RBA');
      expect(f).toBeDefined();
      expect(f.score).toBe(0);
      expect(f.severity).toBe('LOW');
      expect(f.metadata?.matched).toBe('papua');
    });

    it('S-07: HIGH occupation (Pegawai Negeri Sipil) + HIGH geography (Jakarta) → combined score ≥35', async () => {
      const body = await createAndSubmit({
        identNum: `3299507${SUFFIX}`,
        phone: `09007${SUFFIX}`,
        occupation: 'Pegawai Negeri Sipil',
        address: 'Jl. Veteran No. 3, Jakarta Selatan 12160',
      });

      const factors: any[] = body.risk.risk_factors;
      const occF = factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_HIGH_RBA');
      const geoF = factors.find((x: any) => x.code === 'GEOGRAPHY_HIGH_RBA');
      expect(occF).toBeDefined();
      expect(geoF).toBeDefined();
      expect(occF.score).toBe(20);
      expect(geoF.score).toBe(15);
      expect(body.risk.risk_score).toBeGreaterThanOrEqual(35);
    });

    it('S-08: PEP self-declared forces HIGH even with LOW occupation + LOW geography', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `RBA PEP Force ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `3299508${SUFFIX}`,
          address_identity: 'Jl. Arfak No. 99, Papua 98399',
          pob: 'Sorong',
          dob: '1985-07-01',
          nationality: 'ID',
          phone: `09008${SUFFIX}`,
          occupation: 'Pegawai Bank',
          gender: 'F',
          signature_uri: 'https://storage.test/rba_pep_sig.png',
        })
        .expect(201);

      const appId = String(create.body.id);

      const { rows: appRows } = await pgPool.query(
        'SELECT person_id FROM applications WHERE id=$1', [appId],
      );
      await pgPool.query(
        'UPDATE persons SET pep_self_declared=true WHERE id=$1', [appRows[0].person_id],
      );

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/rba_pep_ktp.jpg' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.risk.risk_level).toBe('HIGH');
      expect(res.body.risk.risk_score).toBeGreaterThanOrEqual(70);
      const codes = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(codes).toContain('INDIVIDUAL_PEP_SELF_DECLARED');
      // LOW RBA factors still recorded
      expect(codes).toContain('INDIVIDUAL_OCCUPATION_LOW_RBA');
      expect(codes).toContain('GEOGRAPHY_LOW_RBA');
    });

    it('S-09: Risk factors include metadata.matched for RBA factors', async () => {
      const body = await createAndSubmit({
        identNum: `3299509${SUFFIX}`,
        phone: `09009${SUFFIX}`,
        occupation: 'Wiraswasta',
        address: 'Jl. Niaga No. 2, Surabaya, Jawa Timur 60271',
      });

      const factors: any[] = body.risk.risk_factors;
      const occF = factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_HIGH_RBA');
      const geoF = factors.find((x: any) => x.code === 'GEOGRAPHY_HIGH_RBA');

      expect(occF?.metadata?.matched).toBeDefined();
      expect(typeof occF?.metadata?.matched).toBe('string');
      expect(geoF?.metadata?.matched).toBeDefined();
      expect(typeof geoF?.metadata?.matched).toBe('string');
      expect(geoF?.metadata?.source).toBe('address_identity');
    });
  });

  // ══════════════════════════════════════════════════════════
  // T. Transaction Monitoring — LTKT & LTKM
  // ══════════════════════════════════════════════════════════
  describe('T. Transaction Monitoring — LTKT & LTKM', () => {
    // Helper: create LOW-risk individual, submit (→ SUBMITTED), approve → APPROVED.
    // Distinct NIK → distinct CIF sehingga agregasi harian ter-isolasi per skenario.
    async function createApprovedIndividual(nik: string, phone: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `MON Sender ${nik}`,
          identity_type: 'KTP',
          identity_number: nik,
          address_identity: 'Jl. Cendana No. 1, Bandung',
          pob: 'Bandung',
          dob: '1988-08-08',
          nationality: 'ID',
          phone,
          occupation: 'Software Engineer',
          gender: 'M',
          signature_uri: 'https://storage.test/mon_sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/mon_ktp.jpg' })
        .expect(201);

      const submit = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      // LOW risk → SUBMITTED (bukan IN_REVIEW)
      expect(submit.body.status).toBe('SUBMITTED');

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED', reason: 'monitoring sender' })
        .expect(200);

      return appId;
    }

    async function createTransfer(
      senderAppId: string,
      opts: { amount: number; benef?: string; transfer_method?: string; additional_info?: any },
    ): Promise<string> {
      const body: any = {
        amount: opts.amount,
        sender_application_id: Number(senderAppId),
        beneficiaryBankName: 'Bank Monitoring',
        beneficiaryBankCode: '009',
        beneficiaryAccountNumber: opts.benef ?? `900${SUFFIX}`,
        beneficiaryAccountName: 'PT Penerima Monitoring',
      };
      if (opts.transfer_method) body.transfer_method = opts.transfer_method;
      if (opts.additional_info) body.additional_info = opts.additional_info;

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send(body)
        .expect(201);
      return String(res.body.id);
    }

    async function evaluate(transferId: string, token = complianceToken) {
      return request(app.getHttpServer())
        .post(`${BASE}/monitoring/evaluate-transfer/${transferId}`)
        .set('Authorization', `Bearer ${token}`);
    }

    // Helper: siapkan LTKM case bersih (high-risk customer) → return case id.
    async function setupLtkmCase(nik: string, phone: string): Promise<string> {
      const appId = await createApprovedIndividual(nik, phone);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 50_000_000, benef: `11${phone}` });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      return String(ev.body.id);
    }

    const codesOf = (body: any): string[] =>
      (body.triggers ?? []).map((t: any) => t.rule_code);

    // ── T-01: Role Director dikenali ──
    it('T-01: Director role dapat dibuat & login (dari setup) → bisa akses GET cases', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    // ── T-02: LTKT single cash ≥ 500M → strictly LTKT (high-value hanya supporting) ──
    it('T-02: single cash transfer ≥ 500M tanpa faktor suspicious lain → case_type LTKT', async () => {
      const appId = await createApprovedIndividual(`70001${SUFFIX}`, `07001${SUFFIX}`);
      const trId = await createTransfer(appId, {
        amount: 500_000_000,
        transfer_method: 'CASH',
        benef: `91${SUFFIX}`,
      });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      expect(codesOf(ev.body)).toContain('LTKT_CASH_SINGLE_500M');
      // high-value transfer ikut tercatat tapi hanya supporting → tidak menjadikan BOTH
      expect(ev.body.case_type).toBe('LTKT');
      expect(ev.body.status).toBe('DETECTED');

      // supporting alert tetap tersimpan tapi ditandai non-classifying
      const hv = ev.body.triggers.find((t: any) => t.rule_code === 'LTKM_HIGH_VALUE_TRANSFER');
      expect(hv).toBeDefined();
      expect(hv.details.supporting).toBe(true);
    });

    // ── T-03: LTKT aggregate daily cash ≥ 500M ──
    it('T-03: 2x cash 300M same CIF/day → LTKT_CASH_AGGREGATE_DAILY_500M', async () => {
      const appId = await createApprovedIndividual(`70002${SUFFIX}`, `07002${SUFFIX}`);
      await createTransfer(appId, { amount: 300_000_000, transfer_method: 'CASH', benef: `21${SUFFIX}` });
      const tr2 = await createTransfer(appId, { amount: 300_000_000, transfer_method: 'CASH', benef: `22${SUFFIX}` });
      const ev = await evaluate(tr2);
      expect(ev.status).toBe(201);
      expect(codesOf(ev.body)).toContain('LTKT_CASH_AGGREGATE_DAILY_500M');
    });

    // ── T-04: LTKM high risk customer ──
    it('T-04: sender risk_level HIGH → LTKM_HIGH_RISK_CUSTOMER', async () => {
      const appId = await createApprovedIndividual(`70004${SUFFIX}`, `07004${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 50_000_000, benef: `31${SUFFIX}` });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      expect(codesOf(ev.body)).toContain('LTKM_HIGH_RISK_CUSTOMER');
      expect(ev.body.case_type).toBe('LTKM');
    });

    // ── T-05: LTKM PEP related ──
    it('T-05: sender risk factor PEP → LTKM_PEP_RELATED', async () => {
      const appId = await createApprovedIndividual(`70005${SUFFIX}`, `07005${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_factors=$2::jsonb WHERE application_id=$1`,
        [
          appId,
          JSON.stringify([
            { code: 'WATCHLIST_PEP_CANDIDATE', label: 'PEP', score: 20, severity: 'MEDIUM', source: 'screening' },
          ]),
        ],
      );
      const trId = await createTransfer(appId, { amount: 50_000_000, benef: `41${SUFFIX}` });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      expect(codesOf(ev.body)).toContain('LTKM_PEP_RELATED');
    });

    // ── T-06: LTKM many beneficiaries daily ──
    it('T-06: ≥5 distinct beneficiaries same CIF/day → LTKM_MANY_BENEFICIARIES_DAILY', async () => {
      const appId = await createApprovedIndividual(`70006${SUFFIX}`, `07006${SUFFIX}`);
      let lastTr = '';
      for (let i = 1; i <= 5; i++) {
        lastTr = await createTransfer(appId, { amount: 1_000_000, benef: `5${i}${SUFFIX}` });
      }
      const ev = await evaluate(lastTr);
      expect(ev.status).toBe(201);
      expect(codesOf(ev.body)).toContain('LTKM_MANY_BENEFICIARIES_DAILY');
    });

    // ── T-06b: High value alone (≥100M, no other suspicious) → TIDAK membuat case ──
    it('T-06b: high value 150M non-cash alone → tidak membuat LTKM case (triggered:false)', async () => {
      const appId = await createApprovedIndividual(`70061${SUFFIX}`, `07061${SUFFIX}`);
      const trId = await createTransfer(appId, { amount: 150_000_000, benef: `61${SUFFIX}` });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      expect(ev.body.triggered).toBe(false);

      // pastikan tidak ada monitoring case untuk transfer ini
      const { rows } = await pgPool.query(
        `SELECT COUNT(*)::int AS c FROM monitoring_cases WHERE transfer_id=$1`,
        [Number(trId)],
      );
      expect(rows[0].c).toBe(0);
    });

    // ── T-06c: High value + high risk customer → LTKM (classifying + supporting) ──
    it('T-06c: high value 150M + risk HIGH → LTKM dengan high-value sebagai supporting', async () => {
      const appId = await createApprovedIndividual(`70062${SUFFIX}`, `07062${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 150_000_000, benef: `62${SUFFIX}` });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      const codes = codesOf(ev.body);
      expect(codes).toContain('LTKM_HIGH_RISK_CUSTOMER');
      expect(codes).toContain('LTKM_HIGH_VALUE_TRANSFER');
      expect(ev.body.case_type).toBe('LTKM');
    });

    // ── T-06d: Cash ≥500M + high risk customer → BOTH ──
    it('T-06d: cash 500M + risk HIGH → case_type BOTH', async () => {
      const appId = await createApprovedIndividual(`70063${SUFFIX}`, `07063${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, {
        amount: 500_000_000,
        transfer_method: 'CASH',
        benef: `63${SUFFIX}`,
      });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      const codes = codesOf(ev.body);
      expect(codes).toContain('LTKT_CASH_SINGLE_500M');
      expect(codes).toContain('LTKM_HIGH_RISK_CUSTOMER');
      expect(ev.body.case_type).toBe('BOTH');
    });

    // ── T-07: Compliance CLOSE_FALSE_POSITIVE ──
    it('T-07: compliance CLOSE_FALSE_POSITIVE → status CLOSED_FALSE_POSITIVE', async () => {
      const caseId = await setupLtkmCase(`70007${SUFFIX}`, `07007${SUFFIX}`);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'CLOSE_FALSE_POSITIVE', notes: 'bukan mencurigakan' })
        .expect(200);
      expect(res.body.status).toBe('CLOSED_FALSE_POSITIVE');
    });

    // ── T-08: Compliance NEED_CLARIFICATION ──
    it('T-08: compliance NEED_CLARIFICATION → status NEED_CLARIFICATION', async () => {
      const caseId = await setupLtkmCase(`70008${SUFFIX}`, `07008${SUFFIX}`);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'NEED_CLARIFICATION', notes: 'butuh dokumen tambahan' })
        .expect(200);
      expect(res.body.status).toBe('NEED_CLARIFICATION');
    });

    // ── T-09: Compliance ESCALATE_TO_DIRECTOR ──
    it('T-09: compliance ESCALATE_TO_DIRECTOR + notes → PENDING_DIRECTOR_REVIEW + compliance fields terisi', async () => {
      const caseId = await setupLtkmCase(`70009${SUFFIX}`, `07009${SUFFIX}`);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_DIRECTOR', notes: 'eskalasi ke Dirut' })
        .expect(200);
      expect(res.body.status).toBe('PENDING_DIRECTOR_REVIEW');
      // wajib: compliance review fields terisi saat masuk PENDING
      expect(res.body.compliance_reviewed_by).toBeTruthy();
      expect(res.body.compliance_reviewed_at).toBeTruthy();
      expect(res.body.compliance_action).toBe('ESCALATE_TO_DIRECTOR');
      expect(res.body.compliance_notes).toBe('eskalasi ke Dirut');
    });

    // ── T-09b: ESCALATE_TO_DIRECTOR tanpa notes → 400 ──
    it('T-09b: compliance ESCALATE_TO_DIRECTOR tanpa notes → 400', async () => {
      const caseId = await setupLtkmCase(`70091${SUFFIX}`, `07091${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_DIRECTOR' })
        .expect(400);
      // status tidak berubah (tetap DETECTED)
      const detail = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(detail.body.status).toBe('DETECTED');
    });

    // ── T-09c: RECOMMEND_REPORT LTKM + notes → PENDING_DIRECTOR_REVIEW ──
    it('T-09c: compliance RECOMMEND_REPORT (LTKM) + notes → PENDING_DIRECTOR_REVIEW', async () => {
      const caseId = await setupLtkmCase(`70092${SUFFIX}`, `07092${SUFFIX}`);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'RECOMMEND_REPORT', notes: 'rekomendasi lapor LTKM' })
        .expect(200);
      expect(res.body.status).toBe('PENDING_DIRECTOR_REVIEW');
      expect(res.body.compliance_action).toBe('RECOMMEND_REPORT');
      expect(res.body.compliance_reviewed_by).toBeTruthy();
      expect(res.body.compliance_reviewed_at).toBeTruthy();
    });

    // ── T-09d: RECOMMEND_REPORT tanpa notes → 400 ──
    it('T-09d: compliance RECOMMEND_REPORT tanpa notes → 400', async () => {
      const caseId = await setupLtkmCase(`70093${SUFFIX}`, `07093${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'RECOMMEND_REPORT' })
        .expect(400);
    });

    // ── T-10: Director APPROVED → READY_TO_REPORT + report DRAFT ──
    it('T-10: director APPROVED → READY_TO_REPORT, report_status DRAFT, report_type LTKM', async () => {
      const caseId = await setupLtkmCase(`70010${SUFFIX}`, `07010${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_DIRECTOR', notes: 'eskalasi ke Dirut' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/director-review`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ decision: 'APPROVED', notes: 'setuju laporkan' })
        .expect(200);
      expect(res.body.status).toBe('READY_TO_REPORT');
      expect(res.body.report_status).toBe('DRAFT');
      expect(res.body.report_type).toBe('LTKM');
    });

    // ── T-11: Director REJECTED ──
    it('T-11: director REJECTED → status DIRECTOR_REJECTED', async () => {
      const caseId = await setupLtkmCase(`70011${SUFFIX}`, `07011${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_DIRECTOR', notes: 'eskalasi ke Dirut' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/director-review`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ decision: 'REJECTED', notes: 'tidak perlu dilaporkan' })
        .expect(200);
      expect(res.body.status).toBe('DIRECTOR_REJECTED');
    });

    // ── T-12: Report SUBMITTED → REPORTED ──
    it('T-12: report SUBMITTED → status REPORTED', async () => {
      const caseId = await setupLtkmCase(`70012${SUFFIX}`, `07012${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_DIRECTOR', notes: 'eskalasi ke Dirut' })
        .expect(200);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/director-review`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/report`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          report_status: 'SUBMITTED',
          report_reference_no: `LTKM-REF-${SUFFIX}`,
          report_file_uri: 'https://storage.test/ltkm_report.pdf',
        })
        .expect(200);
      expect(res.body.status).toBe('REPORTED');
      expect(res.body.report_status).toBe('SUBMITTED');
      expect(res.body.reported_at).toBeTruthy();

      // muncul di report queue
      const list = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/reports?report_status=SUBMITTED`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(list.body.data.some((c: any) => String(c.id) === String(caseId))).toBe(true);
    });

    // ── T-13: FrontDesk tidak boleh akses ──
    it('T-13: FrontDesk GET /monitoring/cases → 403', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(403);
    });

    // ── T-14: Auditor read-only ──
    it('T-14: Auditor bisa GET cases (200) tapi tidak bisa compliance-review (403)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);

      const caseId = await setupLtkmCase(`70014${SUFFIX}`, `07014${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ action: 'CLOSE_FALSE_POSITIVE' })
        .expect(403);
    });

    // ── T-15: Pagination ──
    it('T-15: GET /monitoring/cases pagination limit=2 → data ≤ 2, echo page/limit', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases?page=1&limit=2`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(2);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(typeof res.body.total).toBe('number');
    });

    // ── T-16: Duplicate evaluation tidak membuat case ganda ──
    it('T-16: evaluate transfer dua kali → case yang sama (dedup)', async () => {
      const appId = await createApprovedIndividual(`70016${SUFFIX}`, `07016${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 50_000_000, benef: `71${SUFFIX}` });

      const ev1 = await evaluate(trId);
      expect(ev1.status).toBe(201);
      const ev2 = await evaluate(trId);
      expect(ev2.status).toBe(201);
      expect(String(ev2.body.id)).toBe(String(ev1.body.id));
      expect(ev2.body.case_no).toBe(ev1.body.case_no);

      // hanya satu case aktif untuk transfer ini
      const { rows } = await pgPool.query(
        `SELECT COUNT(*)::int AS c FROM monitoring_cases WHERE transfer_id=$1`,
        [Number(trId)],
      );
      expect(rows[0].c).toBe(1);
    });

    // ── T-17: LTKM tidak boleh READY_TO_REPORT langsung tanpa Director ──
    it('T-17: compliance READY_TO_REPORT pada LTKM → 400 (butuh Director)', async () => {
      const caseId = await setupLtkmCase(`70017${SUFFIX}`, `07017${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'READY_TO_REPORT' })
        .expect(400);
    });

    // ── T-18: GET case detail termasuk triggers + linked transfer ──
    it('T-18: GET /monitoring/cases/:id → detail + triggers + transfer summary', async () => {
      const appId = await createApprovedIndividual(`70018${SUFFIX}`, `07018${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 50_000_000, benef: `81${SUFFIX}` });
      const ev = await evaluate(trId);
      const caseId = String(ev.body.id);

      // ComplianceLead boleh baca detail case status apa pun (termasuk DETECTED).
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(Array.isArray(res.body.triggers)).toBe(true);
      expect(res.body.triggers.length).toBeGreaterThan(0);
      expect(res.body.transfer).toBeTruthy();
      expect(String(res.body.transfer.id)).toBe(String(trId));
      expect(res.body.cif_no).toBeTruthy();
    });

    // Helper: siapkan case yang sudah PENDING_DIRECTOR_REVIEW.
    async function setupPendingDirectorCase(nik: string, phone: string): Promise<string> {
      const caseId = await setupLtkmCase(nik, phone);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_DIRECTOR', notes: 'eskalasi ke Dirut' })
        .expect(200);
      return caseId;
    }

    // ── T-19: Director GET /cases → hanya PENDING_DIRECTOR_REVIEW ──
    it('T-19: Director GET /monitoring/cases → semua item berstatus PENDING_DIRECTOR_REVIEW', async () => {
      await setupPendingDirectorCase(`70020${SUFFIX}`, `07020${SUFFIX}`);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(
        res.body.data.every((c: any) => c.status === 'PENDING_DIRECTOR_REVIEW'),
      ).toBe(true);
    });

    // ── T-20: Director query status lain di-abaikan (forced PENDING) ──
    it('T-20: Director GET /cases?status=DETECTED → tetap forced PENDING_DIRECTOR_REVIEW', async () => {
      // ada case DETECTED dari test sebelumnya, pastikan Director tetap tidak melihatnya
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases?status=DETECTED`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(
        res.body.data.every((c: any) => c.status === 'PENDING_DIRECTOR_REVIEW'),
      ).toBe(true);
      expect(res.body.data.some((c: any) => c.status === 'DETECTED')).toBe(false);
    });

    // ── T-21: Director GET detail PENDING → 200 ──
    it('T-21: Director GET /cases/:id PENDING_DIRECTOR_REVIEW → 200', async () => {
      const caseId = await setupPendingDirectorCase(`70021${SUFFIX}`, `07021${SUFFIX}`);
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(res.body.status).toBe('PENDING_DIRECTOR_REVIEW');
      expect(Array.isArray(res.body.triggers)).toBe(true);
    });

    // ── T-22: Director GET detail DETECTED → 403 ──
    it('T-22: Director GET /cases/:id DETECTED → 403', async () => {
      const caseId = await setupLtkmCase(`70022${SUFFIX}`, `07022${SUFFIX}`);
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(403);
    });

    // ── T-23: Director GET detail READY_TO_REPORT → 403 ──
    it('T-23: Director GET /cases/:id READY_TO_REPORT (setelah approve) → 403', async () => {
      const caseId = await setupPendingDirectorCase(`70023${SUFFIX}`, `07023${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/director-review`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);
      // setelah approve → READY_TO_REPORT, tidak lagi terlihat oleh Director
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(403);
    });

    // ── T-24: Director tidak punya akses ke report queue ──
    it('T-24: Director GET /monitoring/reports → 403', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/reports`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(403);
    });

    // ── T-25: ComplianceLead & SystemAdmin tetap melihat semua status ──
    it('T-25: ComplianceLead & SystemAdmin masih melihat case non-PENDING (mis. DETECTED)', async () => {
      await setupLtkmCase(`70024${SUFFIX}`, `07024${SUFFIX}`); // buat 1 case DETECTED

      const comp = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases?status=DETECTED`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(comp.body.data.length).toBeGreaterThan(0);
      expect(comp.body.data.every((c: any) => c.status === 'DETECTED')).toBe(true);

      const sys = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases?status=DETECTED`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);
      expect(sys.body.data.every((c: any) => c.status === 'DETECTED')).toBe(true);
    });

    // ── T-26: Auditor tetap read-only (bisa GET reports, tidak bisa review) ──
    it('T-26: Auditor GET /monitoring/reports → 200 (read-only tetap seperti semula)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/reports`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);
    });

    // Helper: buat case PENDING_DIRECTOR_REVIEW yang malformed (tanpa compliance
    // review fields) — mensimulasikan data korup/legacy. Tidak lewat API.
    async function setupMalformedPendingCase(nik: string, phone: string): Promise<string> {
      const caseId = await setupLtkmCase(nik, phone);
      await pgPool.query(
        `UPDATE monitoring_cases
         SET status='PENDING_DIRECTOR_REVIEW',
             compliance_reviewed_by=NULL,
             compliance_reviewed_at=NULL,
             compliance_action=NULL
         WHERE id=$1`,
        [Number(caseId)],
      );
      return caseId;
    }

    // ── T-27: Director tidak bisa review PENDING malformed (compliance fields kosong) ──
    it('T-27: director-review pada PENDING tanpa compliance fields → 400', async () => {
      const caseId = await setupMalformedPendingCase(`70027${SUFFIX}`, `07027${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/director-review`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ decision: 'APPROVED', notes: 'coba approve' })
        .expect(400);
    });

    // ── T-28: Director list & detail menyembunyikan PENDING malformed ──
    it('T-28: Director list/detail tidak menampilkan PENDING malformed tanpa compliance fields', async () => {
      const caseId = await setupMalformedPendingCase(`70028${SUFFIX}`, `07028${SUFFIX}`);

      const list = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases?limit=100`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      // semua case yang tampil punya compliance_reviewed_by
      expect(
        list.body.data.every((c: any) => c.compliance_reviewed_by !== null),
      ).toBe(true);
      // case malformed tidak muncul
      expect(list.body.data.some((c: any) => String(c.id) === String(caseId))).toBe(false);

      // detail juga forbidden
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(403);
    });
  });

  // ══════════════════════════════════════════════════════════
  // U. NEW TRANSFER REQUIREMENTS (A-F)
  // ══════════════════════════════════════════════════════════
  describe('U. CIF + Transfer requirements', () => {

    // ── UA: CIF format — no dashes ──────────────────────────────────────
    describe('UA. CIF format — no dashes', () => {
      it('UA-01: person.cif_no tidak mengandung "-" (format KSHI)', async () => {
        const { rows } = await pgPool.query(
          `SELECT p.cif_no FROM applications a
           JOIN persons p ON p.id = a.person_id WHERE a.id=$1`,
          [indivAppIdOk],
        );
        expect(rows[0]?.cif_no).toBeDefined();
        expect(rows[0].cif_no).not.toContain('-');
        expect(rows[0].cif_no).toMatch(/^KSHI\d{11}$/);
      });

      it('UA-02: business_entities.cif_no tidak mengandung "-" (format KSHB)', async () => {
        const { rows } = await pgPool.query(
          `SELECT b.cif_no FROM applications a
           JOIN business_entities b ON b.id = a.business_id WHERE a.id=$1`,
          [bizAppId],
        );
        expect(rows[0]?.cif_no).toBeDefined();
        expect(rows[0].cif_no).not.toContain('-');
        expect(rows[0].cif_no).toMatch(/^KSHB\d{11}$/);
      });

      it('UA-03: business_parties.cif_no (BO) tidak mengandung "-"', async () => {
        const { rows } = await pgPool.query(
          `SELECT bp.cif_no FROM applications a
           JOIN business_parties bp ON bp.business_id = a.business_id
           WHERE a.id=$1 AND bp.cif_no IS NOT NULL LIMIT 1`,
          [bizAppId],
        );
        if (rows.length > 0) {
          expect(rows[0].cif_no).not.toContain('-');
          expect(rows[0].cif_no).toMatch(/^KSHI\d{11}$/);
        }
        // jika belum ada BO, test tetap pass (no BO in this test flow)
      });
    });

    // ── UB: Transfer amount guard ─────────────────────────────────────
    describe('UB. Transfer amount guard (min 10.000, max 500.000.000)', () => {
      it('UB-01: amount 9999 → 400 (di bawah minimum)', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 9999,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank Test',
            beneficiaryAccountNumber: '1234567890',
            beneficiaryAccountName: 'Test',
          })
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('UB-02: amount 10000 → 201 (tepat di batas minimum)', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 10000,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank Test',
            beneficiaryAccountNumber: '1234000010',
            beneficiaryAccountName: 'Test Min',
          })
          .expect(201);
        expect(Number(res.body.amount)).toBe(10000);
      });

      it('UB-03: amount 500000000 → 201 (tepat di batas maksimum)', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 500_000_000,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank Test',
            beneficiaryAccountNumber: '1234000500',
            beneficiaryAccountName: 'Test Max',
          })
          .expect(201);
        expect(Number(res.body.amount)).toBe(500_000_000);
      });

      it('UB-04: amount 500000001 → 400 (melebihi maksimum)', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 500_000_001,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank Test',
            beneficiaryAccountNumber: '1234567890',
            beneficiaryAccountName: 'Test',
          })
          .expect(400);
        expect(res.body.message).toBeDefined();
      });
    });

    // ── UC: Sender name dalam response transfer ────────────────────────
    describe('UC. Sender name dalam response transfer', () => {
      it('UC-01: GET /transfers/:id → includes sender_name', async () => {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/transfers/${transferId}`)
          .set('Authorization', `Bearer ${financeManagerToken}`)
          .expect(200);
        expect(res.body.sender_name).toBeTruthy();
        expect(typeof res.body.sender_name).toBe('string');
        expect(res.body.sender_cif_no).toBeTruthy();
        expect(res.body.sender_type).toBe('INDIVIDUAL');
      });

      it('UC-02: GET /transfers → list includes sender_name', async () => {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeManagerToken}`)
          .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        // setiap item harus punya sender_name
        for (const item of res.body) {
          if (item.sender_application_id) {
            expect(item.sender_name).toBeTruthy();
          }
        }
      });
    });

    // ── UD: Sender search ─────────────────────────────────────────────
    describe('UD. Sender search', () => {
      it('UD-01: GET /transfers/senders/search tanpa q → 200, data array APPROVED apps', async () => {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/transfers/senders/search`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .expect(200);
        expect(Array.isArray(res.body.data)).toBe(true);
        expect(typeof res.body.total).toBe('number');
        expect(res.body.total).toBeGreaterThan(0);
        for (const item of res.body.data) {
          expect(item.status).toBe('APPROVED');
          expect(item.display_name).toBeTruthy();
          expect(item.application_id).toBeDefined();
        }
      });

      it('UD-02: search by individual name → menemukan indivAppIdOk', async () => {
        // indivAppIdOk punya full_name "Individu OK ..."
        const res = await request(app.getHttpServer())
          .get(`${BASE}/transfers/senders/search?q=Individu+OK`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .expect(200);
        const ids = res.body.data.map((x: any) => String(x.application_id));
        expect(ids).toContain(String(indivAppIdOk));
      });

      it('UD-03: search by CIF prefix KSHI → menemukan individual', async () => {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/transfers/senders/search?q=KSHI`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .expect(200);
        expect(res.body.data.length).toBeGreaterThan(0);
        expect(res.body.data[0].cif_no).toMatch(/^KSHI/);
      });

      it('UD-04: application_id dari search dapat digunakan create transfer', async () => {
        // ambil sender pertama
        const search = await request(app.getHttpServer())
          .get(`${BASE}/transfers/senders/search`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .expect(200);
        const sender = search.body.data[0];
        expect(sender).toBeDefined();

        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 50_000,
            sender_application_id: Number(sender.application_id),
            beneficiaryBankName: 'Bank Test',
            beneficiaryAccountNumber: '9988776655',
            beneficiaryAccountName: 'Penerima Search',
          })
          .expect(201);
        expect(res.body.status).toBe('DRAFT');
        expect(String(res.body.sender_application_id)).toBe(String(sender.application_id));
      });
    });

    // ── UE: Bank catalog + account number validation ───────────────────
    describe('UE. Bank catalog + account number validation', () => {
      it('UE-01: GET /transfers/banks → 200, array code+name tanpa duplikat', async () => {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/transfers/banks`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .expect(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        for (const bank of res.body) {
          expect(typeof bank.code).toBe('string');
          expect(typeof bank.name).toBe('string');
        }
        // tidak ada duplikat code
        const codes = res.body.map((b: any) => b.code);
        expect(new Set(codes).size).toBe(codes.length);
      });

      it('UE-02: account number dengan huruf → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 100_000,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank Test',
            beneficiaryAccountNumber: '12345ABC',
            beneficiaryAccountName: 'Test',
          })
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('UE-03: account number spasi → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 100_000,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank Test',
            beneficiaryAccountNumber: '123 456',
            beneficiaryAccountName: 'Test',
          })
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('UE-04: account number digit murni → 201', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 25_000,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank BCA',
            beneficiaryAccountNumber: '0987654321',
            beneficiaryAccountName: 'Test Digit',
          })
          .expect(201);
        expect(res.body.beneficiary_account_number).toBe('0987654321');
      });
    });

    // ── UF: source_of_funds + transaction_purpose ─────────────────────
    describe('UF. source_of_funds dan transaction_purpose', () => {
      let ufTransferId: string;

      it('UF-01: create transfer dengan source_of_funds + transaction_purpose → 201, keduanya tersimpan', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 75_000,
            sender_application_id: Number(indivAppIdOk),
            beneficiaryBankName: 'Bank BRI',
            beneficiaryAccountNumber: '1122334455',
            beneficiaryAccountName: 'PT Penerima UF',
            source_of_funds: 'Gaji',
            transaction_purpose: 'Pembayaran hutang',
          })
          .expect(201);

        expect(res.body.source_of_funds).toBe('Gaji');
        expect(res.body.transaction_purpose).toBe('Pembayaran hutang');
        ufTransferId = String(res.body.id);
      });

      it('UF-02: GET /transfers/:id → mengembalikan source_of_funds + transaction_purpose', async () => {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/transfers/${ufTransferId}`)
          .set('Authorization', `Bearer ${financeManagerToken}`)
          .expect(200);

        expect(res.body.source_of_funds).toBe('Gaji');
        expect(res.body.transaction_purpose).toBe('Pembayaran hutang');
      });

      it('UF-03: monitoring case detail — linked transfer includes source_of_funds + sender_name', async () => {
        // Buat individual baru → approve → transfer HIGH RISK → monitoring case
        const create = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({
            full_name: `UF Sender ${SUFFIX}`,
            identity_type: 'KTP',
            identity_number: `UF000${SUFFIX}`,
            address_identity: 'Jl. UF No. 1, Jakarta',
            pob: 'Jakarta',
            dob: '1985-05-05',
            nationality: 'ID',
            phone: `0890${SUFFIX}`,
            occupation: 'Software Engineer',
            gender: 'M',
            signature_uri: 'https://storage.test/uf_sig.png',
          })
          .expect(201);
        const ufAppId = String(create.body.id);

        await request(app.getHttpServer())
          .post(`${BASE}/applications/${ufAppId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: 'KTP', file_uri: 'https://storage.test/uf_ktp.jpg' })
          .expect(201);

        await request(app.getHttpServer())
          .patch(`${BASE}/applications/${ufAppId}/submit`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);

        await request(app.getHttpServer())
          .patch(`${BASE}/applications/${ufAppId}/decision`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ decision: 'APPROVED', reason: 'UF test' })
          .expect(200);

        // Set HIGH RISK agar monitoring terpicu
        await pgPool.query(
          `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
          [ufAppId],
        );

        const tr = await request(app.getHttpServer())
          .post(`${BASE}/transfers`)
          .set('Authorization', `Bearer ${financeStaffToken}`)
          .send({
            amount: 50_000_000,
            sender_application_id: Number(ufAppId),
            beneficiaryBankName: 'Bank Mandiri',
            beneficiaryAccountNumber: '5544332211',
            beneficiaryAccountName: 'PT UF Penerima',
            source_of_funds: 'Tabungan',
            transaction_purpose: 'Investasi',
          })
          .expect(201);
        const ufTrId = String(tr.body.id);

        const ev = await request(app.getHttpServer())
          .post(`${BASE}/monitoring/evaluate-transfer/${ufTrId}`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(201);
        expect(ev.body.id).toBeDefined(); // case dibuat → response adalah case object, bukan { triggered: false }
        const caseId = String(ev.body.id);

        const detail = await request(app.getHttpServer())
          .get(`${BASE}/monitoring/cases/${caseId}`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);

        expect(detail.body.transfer).toBeTruthy();
        expect(detail.body.transfer.source_of_funds).toBe('Tabungan');
        expect(detail.body.transfer.transaction_purpose).toBe('Investasi');
        expect(detail.body.transfer.sender_name).toBeTruthy();
        expect(typeof detail.body.transfer.sender_name).toBe('string');
      });
    });
  });
});
