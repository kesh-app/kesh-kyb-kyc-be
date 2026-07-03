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
  let frontDeskToken: string;

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

      expect(Array.isArray(res.body)).toBe(true);
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
});
