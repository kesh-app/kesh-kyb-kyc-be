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

  // Tokens
  let complianceToken: string;
  let sysAdminToken: string;
  let financeStaffToken: string;
  let financeManagerToken: string;

  // Application IDs yang diakumulasi lintas describe block
  // pg driver mengembalikan BIGINT sebagai string — simpan sebagai string
  let indivAppIdMissing: string;
  let indivAppIdOk: string;
  let bizAppId: string;

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

    it('B-02: GET /applications/:id → 200, detail dengan documents + parties', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdMissing}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.application.status).toBe('DRAFT');
      expect(res.body.application.type).toBe('INDIVIDUAL');
      expect(Array.isArray(res.body.documents)).toBe(true);
      expect(Array.isArray(res.body.parties)).toBe(true);
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

    it('D-02: POST /documents (KTP) → 201, status PENDING', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${indivAppIdOk}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'KTP',
          file_uri: 'https://storage.test/docs/ktp.jpg',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('KTP');
      expect(res.body.status).toBe('PENDING');
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
    it('I-01: GET /watchlist/history → 200 array', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/watchlist/history`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
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
  });
});
