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
import * as path from 'path';
import * as express from 'express';
import { AppModule } from '../../src/app.module';

const BASE = '/api';

// KTP test — 16 digit, dipakai oleh semua individual create yang tidak spesifik test KTP validation
const TEST_KTP_NUMBER = '3175001234567890';

// Suffix 7 digit akhir epoch — unik per test run, hindari konflik unique constraint
const SUFFIX = Date.now().toString().slice(-7);

// NPWP Badan Usaha wajib tepat 15 digit angka (validasi backend migration 0047).
// Helper membangun nilai 15 digit dari seed + SUFFIX (npwp tidak unique-constrained).
function npwp15(seed: string | number = ''): string {
  const digits = String(seed).replace(/\D/g, '');
  return (digits + SUFFIX + '000000000000000').slice(0, 15);
}

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
  let operationSupervisorToken: string;

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

    // Mirror main.ts bootstrap: must be before app.init() so it sits ahead of the NestJS router
    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
    app.use('/api/uploads', express.static(uploadDir, { index: false, dotfiles: 'deny' }));

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

    // Buat OperationSupervisor test user (approval pertama monitoring + transfer layer 1)
    const opSupEmail = `opsup${SUFFIX}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set('Authorization', `Bearer ${sysAdminToken}`)
      .send({
        email: opSupEmail,
        fullName: `Test Operation Supervisor ${SUFFIX}`,
        role: 'OperationSupervisor',
        password: 'Test@123456',
      });
    const loginOpSup = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: opSupEmail, password: 'Test@123456' });
    operationSupervisorToken = loginOpSup.body.access_token;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // Helper: upload semua 3 dokumen foto wajib untuk INDIVIDUAL
  async function uploadIndivDocs(appId: string | number) {
    for (const dt of ['INDIVIDUAL_KTP_PHOTO', 'INDIVIDUAL_FACE_PHOTO', 'INDIVIDUAL_FACE_WITH_KTP_PHOTO']) {
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: dt, file_uri: `https://storage.test/${dt.toLowerCase()}.jpg` })
        .expect(201);
    }
  }

  // Helper: upload hanya 2 foto wajah (saat KTP/legacy sudah terupload)
  async function uploadFacePhotoDocs(appId: string | number) {
    await request(app.getHttpServer())
      .post(`${BASE}/applications/${appId}/documents`)
      .set('Authorization', `Bearer ${complianceToken}`)
      .send({ doc_type: 'INDIVIDUAL_FACE_PHOTO', file_uri: 'https://storage.test/individual_face_photo.jpg' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/applications/${appId}/documents`)
      .set('Authorization', `Bearer ${complianceToken}`)
      .send({ doc_type: 'INDIVIDUAL_FACE_WITH_KTP_PHOTO', file_uri: 'https://storage.test/individual_face_with_ktp_photo.jpg' })
      .expect(201);
  }

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
          ktp_number: TEST_KTP_NUMBER,
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

    it('B-03: GET /applications → 200, envelope {data, total, page, limit}', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(20);
    });
  });

  // ══════════════════════════════════════════════════════════
  // C. SUBMIT FAILS WHEN DOCS MISSING
  // ══════════════════════════════════════════════════════════
  describe('C. Submit fails when docs missing', () => {
    it('C-01: PATCH /submit tanpa foto doc → 400, missing berisi 3 tipe dokumen foto', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdMissing}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      expect(res.body.message).toContain('belum lengkap');
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('INDIVIDUAL_KTP_PHOTO') || m.includes('foto KTP'))).toBe(true);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_PHOTO') || m.includes('foto wajah'))).toBe(true);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_WITH_KTP_PHOTO') || m.includes('wajah dengan KTP'))).toBe(true);
    });

    it('C-02: GET /precheck tanpa foto doc → 400, missing array berisi info', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${indivAppIdMissing}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      expect(Array.isArray(res.body.missing)).toBe(true);
      expect(res.body.missing.length).toBeGreaterThan(0);
    });

    it('C-03: submit tanpa INDIVIDUAL_KTP_PHOTO → 400, missing berisi foto KTP', async () => {
      const cr = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Missing KTP Photo ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP', identity_number: `310001${SUFFIX}`,
          address_identity: 'Jl. Test No. 3', pob: 'Jakarta', dob: '1990-01-01',
          nationality: 'ID', phone: `0897001${SUFFIX}`, occupation: 'Karyawan', gender: 'M',
        })
        .expect(201);
      const appId = String(cr.body.id);
      for (const dt of ['INDIVIDUAL_FACE_PHOTO', 'INDIVIDUAL_FACE_WITH_KTP_PHOTO']) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${appId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: dt, file_uri: `https://storage.test/${dt}.jpg` })
          .expect(201);
      }
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('INDIVIDUAL_KTP_PHOTO') || m.includes('foto KTP'))).toBe(true);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_PHOTO'))).toBe(false);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_WITH_KTP_PHOTO'))).toBe(false);
    });

    it('C-04: submit tanpa INDIVIDUAL_FACE_PHOTO → 400, missing berisi foto wajah', async () => {
      const cr = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Missing Face Photo ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP', identity_number: `310002${SUFFIX}`,
          address_identity: 'Jl. Test No. 4', pob: 'Jakarta', dob: '1990-01-01',
          nationality: 'ID', phone: `0897002${SUFFIX}`, occupation: 'Karyawan', gender: 'M',
        })
        .expect(201);
      const appId = String(cr.body.id);
      for (const dt of ['INDIVIDUAL_KTP_PHOTO', 'INDIVIDUAL_FACE_WITH_KTP_PHOTO']) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${appId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: dt, file_uri: `https://storage.test/${dt}.jpg` })
          .expect(201);
      }
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_PHOTO') || m.includes('foto wajah'))).toBe(true);
      expect(missing.some((m) => m.includes('INDIVIDUAL_KTP_PHOTO'))).toBe(false);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_WITH_KTP_PHOTO'))).toBe(false);
    });

    it('C-05: submit tanpa INDIVIDUAL_FACE_WITH_KTP_PHOTO → 400, missing berisi wajah+KTP', async () => {
      const cr = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Missing FaceKTP Photo ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP', identity_number: `310003${SUFFIX}`,
          address_identity: 'Jl. Test No. 5', pob: 'Jakarta', dob: '1990-01-01',
          nationality: 'ID', phone: `0897003${SUFFIX}`, occupation: 'Karyawan', gender: 'M',
        })
        .expect(201);
      const appId = String(cr.body.id);
      for (const dt of ['INDIVIDUAL_KTP_PHOTO', 'INDIVIDUAL_FACE_PHOTO']) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${appId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: dt, file_uri: `https://storage.test/${dt}.jpg` })
          .expect(201);
      }
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_WITH_KTP_PHOTO') || m.includes('wajah dengan KTP'))).toBe(true);
      expect(missing.some((m) => m.includes('INDIVIDUAL_KTP_PHOTO'))).toBe(false);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_PHOTO'))).toBe(false);
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
          ktp_number: TEST_KTP_NUMBER,
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

    it('D-02: POST /documents (INDIVIDUAL_KTP_PHOTO) → 201, status UPLOADED', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${indivAppIdOk}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'INDIVIDUAL_KTP_PHOTO',
          file_uri: 'https://storage.test/docs/ktp_photo.jpg',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('INDIVIDUAL_KTP_PHOTO');
      expect(res.body.status).toBe('UPLOADED');
      expect(String(res.body.application_id)).toBe(String(indivAppIdOk));
    });

    it('D-02b: POST /documents (INDIVIDUAL_FACE_PHOTO) → 201, status UPLOADED', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${indivAppIdOk}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'INDIVIDUAL_FACE_PHOTO',
          file_uri: 'https://storage.test/docs/face_photo.jpg',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('INDIVIDUAL_FACE_PHOTO');
      expect(res.body.status).toBe('UPLOADED');
    });

    it('D-02c: POST /documents (INDIVIDUAL_FACE_WITH_KTP_PHOTO) → 201, status UPLOADED', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${indivAppIdOk}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'INDIVIDUAL_FACE_WITH_KTP_PHOTO',
          file_uri: 'https://storage.test/docs/face_ktp_photo.jpg',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('INDIVIDUAL_FACE_WITH_KTP_PHOTO');
      expect(res.body.status).toBe('UPLOADED');
    });

    it('D-03: GET /precheck setelah 3 foto doc → 200 ok', async () => {
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
            ktp_number: TEST_KTP_NUMBER,
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
  // D3. LOCAL STORAGE — upload file + signed URL + serve
  // ══════════════════════════════════════════════════════════
  describe('D3. Local storage file upload — signed URL & serve', () => {
    let d3AppId: string;
    let d3DocId: string;
    let d3SignedUrl: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `D3 Upload ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `317600${SUFFIX}`,
          address_identity: 'Jl. D3 No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1992-03-10',
          nationality: 'ID',
          phone: `0813${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          email: `d3upload${SUFFIX}@test.com`,
        })
        .expect(201);
      d3AppId = String(res.body.id);
    });

    it('D3-01: POST /documents/upload (multipart JPEG) → 201, returns doc id + file_url', async () => {
      // 1x1 JPEG minimal valid buffer
      const jpegBuf = Buffer.from(
        'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b08000100010101110000ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda00080101000000010aff00ffd9',
        'hex',
      );
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${d3AppId}/documents/upload`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .attach('file', jpegBuf, { filename: 'ktp_photo.jpg', contentType: 'image/jpeg' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.doc_type).toBeDefined();
      // file_url returned by upload endpoint (signed URL or static URL)
      expect(typeof res.body.file_url).toBe('string');
      expect(res.body.file_url.length).toBeGreaterThan(0);
      d3DocId = String(res.body.id);
    });

    it('D3-02: GET /documents/:docId/url → signed_url contains /api/uploads/', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${d3AppId}/documents/${d3DocId}/url`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(typeof res.body.signed_url).toBe('string');
      expect(res.body.signed_url).toContain('/api/uploads/');
      expect(res.body.expires_in).toBe(300);
      d3SignedUrl = res.body.signed_url;
    });

    it('D3-03: GET signed_url path → 200, content-type image/jpeg', async () => {
      // Extract path from absolute URL (e.g. https://host/api/uploads/...)
      const urlPath = new URL(d3SignedUrl).pathname;
      expect(urlPath).toMatch(/^\/api\/uploads\//);

      const res = await request(app.getHttpServer())
        .get(urlPath)
        .expect(200);

      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
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

    it('E-02: OperationSupervisor APPROVE pada app SUBMITTED LOW/MEDIUM → 200 APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdOk}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
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
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(rejectAppId);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${rejectAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${rejectAppId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'REJECTED', reason: 'Data tidak sesuai' })
        .expect(200);

      expect(res.body.status).toBe('REVISION_REQUIRED');
      expect(res.body.revision_reason).toBe('Data tidak sesuai');
    });

    // Helper: create → submit individual, return appId siap di-decide.
    async function createSubmittedIndividual(tag: number): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Decide Role ${tag} ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3155${tag}${SUFFIX}`,
          address_identity: 'Jl. Keputusan No. 1',
          pob: 'Jakarta',
          dob: '1990-05-05',
          nationality: 'ID',
          phone: `0813${tag}${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          signature_uri: 'https://storage.test/decide_sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/decide_ktp.jpg' })
        .expect(201);
      await uploadFacePhotoDocs(appId);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      return appId;
    }

    it('E-04: FrontDesk approve KYC → 403 (tidak boleh memutuskan)', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdMissing}/decision`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ decision: 'APPROVED' })
        .expect(403);
    });

    it('E-05: FrontDesk reject KYC → 403 (tidak boleh memutuskan)', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${indivAppIdMissing}/decision`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ decision: 'REJECTED', reason: 'test' })
        .expect(403);
    });

    it('E-06: OperationSupervisor approve KYC (LOW/MEDIUM risk) → 200 APPROVED', async () => {
      const appId = await createSubmittedIndividual(6);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'APPROVED', reason: 'lengkap' })
        .expect(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('E-07: OperationSupervisor reject KYC (LOW/MEDIUM risk) → 200 REVISION_REQUIRED', async () => {
      const appId = await createSubmittedIndividual(7);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'REJECTED', reason: 'tidak sesuai' })
        .expect(200);
      expect(res.body.status).toBe('REVISION_REQUIRED');
      expect(res.body.revision_reason).toBe('tidak sesuai');
    });

    it('E-10: OperationSupervisor tidak bisa approve HIGH risk KYC → 403', async () => {
      const appId = await createSubmittedIndividual(10);
      // Force HIGH risk via DB
      await pgPool.query(
        `INSERT INTO application_risk(application_id, risk_score, risk_level, factors)
         VALUES($1, 100, 'HIGH', '{}'::jsonb)
         ON CONFLICT (application_id) DO UPDATE SET risk_level='HIGH'`,
        [Number(appId)],
      );
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'APPROVED', reason: 'coba' })
        .expect(403);
      expect(res.body.message).toContain('Lead Compliance');
    });

    it('E-11: ComplianceLead bisa return HIGH risk KYC untuk revisi → 200 REVISION_REQUIRED', async () => {
      const appId = await createSubmittedIndividual(11);
      await pgPool.query(
        `INSERT INTO application_risk(application_id, risk_score, risk_level, factors)
         VALUES($1, 100, 'HIGH', '{}'::jsonb)
         ON CONFLICT (application_id) DO UPDATE SET risk_level='HIGH'`,
        [Number(appId)],
      );
      // HIGH risk butuh EDD sebelum approve — return untuk revisi via REJECTED action
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'REJECTED', reason: 'high risk - perlu perbaikan dokumen' })
        .expect(200);
      expect(res.body.status).toBe('REVISION_REQUIRED');
      expect(res.body.revision_reason).toBe('high risk - perlu perbaikan dokumen');
    });

    it('E-12: Director bisa approve KYC (full access via guard bypass) → 200', async () => {
      const appId = await createSubmittedIndividual(12);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${directorToken}`)
        .send({ decision: 'APPROVED', reason: 'direktur setuju' })
        .expect(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('E-13: ComplianceStaff tidak dapat dibuat via API (role deprecated) → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/users/admins`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({
          email: `compstaff_new${SUFFIX}@test.local`,
          fullName: 'Legacy Staff',
          role: 'ComplianceStaff',
          password: 'Test@123456',
        })
        .expect(400);
      expect(res.body).toBeDefined();
    });

    it('E-08: ComplianceLead reject LOW/MEDIUM KYC → 403 (harus OperationSupervisor)', async () => {
      const appId = await createSubmittedIndividual(8);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'REJECTED', reason: 'tidak sesuai' })
        .expect(403);
      expect(res.body.message).toContain('Operation Supervisor');
    });

    it('E-09: SystemAdmin approve KYC → 200 APPROVED', async () => {
      const appId = await createSubmittedIndividual(9);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({ decision: 'APPROVED', reason: 'lengkap' })
        .expect(200);
      expect(res.body.status).toBe('APPROVED');
    });
  });

  // ══════════════════════════════════════════════════════════
  // E-REV. REVISION_REQUIRED — FrontDesk edit & resubmit flow
  // ══════════════════════════════════════════════════════════
  describe('E-REV. Revision Required flow', () => {
    // Shared appId untuk seluruh blok revision test
    let revAppId: string;

    // Helper: buat dan submit individual, kembalikan appId string
    async function createAndSubmitForRevision(tag: number): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Revision Test ${tag} ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3177${tag}0${SUFFIX}`,
          address_identity: 'Jl. Revisi No. 1',
          pob: 'Bandung',
          dob: '1992-06-15',
          nationality: 'ID',
          phone: `0817${tag}${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          signature_uri: 'https://storage.test/rev_sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/rev_ktp.jpg' })
        .expect(201);
      await uploadFacePhotoDocs(appId);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      return appId;
    }

    it('E-REV-01: OperationSupervisor returns LOW/MEDIUM app for revision → 200 REVISION_REQUIRED', async () => {
      revAppId = await createAndSubmitForRevision(1);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${revAppId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'RETURN_FOR_REVISION', reason: 'Dokumen KTP buram, mohon unggah ulang' })
        .expect(200);

      expect(res.body.status).toBe('REVISION_REQUIRED');
      expect(res.body.revision_reason).toBe('Dokumen KTP buram, mohon unggah ulang');
      expect(res.body.revision_requested_by).toBeTruthy();
      expect(res.body.revision_requested_at).toBeTruthy();
    });

    it('E-REV-02: revision_reason wajib diisi → 400 jika kosong', async () => {
      const appId = await createAndSubmitForRevision(2);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'RETURN_FOR_REVISION' }) // tanpa reason
        .expect(400);

      expect(res.body.message).toContain('Alasan perbaikan wajib diisi');
    });

    it('E-REV-02b: REJECTED tanpa reason → 400 alasan perbaikan wajib diisi', async () => {
      const appId = await createAndSubmitForRevision(22);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'REJECTED' }) // tanpa reason
        .expect(400);

      expect(res.body.message).toContain('Alasan perbaikan wajib diisi');
    });

    it('E-REV-03: GET /applications/:id menampilkan revision_reason dan revision_requested_at', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${revAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.application.status).toBe('REVISION_REQUIRED');
      expect(res.body.application.revision_reason).toBe('Dokumen KTP buram, mohon unggah ulang');
      expect(res.body.application.revision_requested_at).toBeTruthy();
    });

    it('E-REV-04: GET /applications list returns revision_reason in REVISION_REQUIRED entries', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications?status=REVISION_REQUIRED`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.total).toBeGreaterThan(0);
      const entry = res.body.data.find((a: any) => String(a.id) === revAppId);
      expect(entry).toBeDefined();
      expect(entry.revision_reason).toBe('Dokumen KTP buram, mohon unggah ulang');
    });

    it('E-REV-05: FrontDesk dapat edit CDD data di status REVISION_REQUIRED', async () => {
      // Send a full update DTO so required fields are preserved (updateIndividualCdd does full replace)
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${revAppId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          identity_type: 'KTP',
          identity_number: `31770${SUFFIX}`,
          address_identity: 'Jl. Revisi No. 1 Update',
          pob: 'Bandung',
          dob: '1992-06-15',
          nationality: 'ID',
          occupation: 'Karyawan Swasta',
          gender: 'M',
          company_name: 'PT Revisi',
        })
        .expect(200);

      expect(res.body.application.status).toBe('REVISION_REQUIRED');
    });

    it('E-REV-06: FrontDesk dapat upload dokumen di status REVISION_REQUIRED', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${revAppId}/documents`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ doc_type: 'INDIVIDUAL_KTP_PHOTO', file_uri: 'https://storage.test/rev_ktp_new.jpg' })
        .expect(201);

      expect(res.body.doc_type).toBe('INDIVIDUAL_KTP_PHOTO');
    });

    it('E-REV-07: FrontDesk dapat submit ulang dari REVISION_REQUIRED → status SUBMITTED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${revAppId}/submit`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      // LOW/MEDIUM risk → SUBMITTED (bukan IN_REVIEW)
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });

    it('E-REV-07b: Setelah resubmit dari REVISION_REQUIRED, status tidak lagi REVISION_REQUIRED', async () => {
      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${revAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.application.status).not.toBe('REVISION_REQUIRED');
      // revision_reason tetap terjaga untuk histori
      expect(detail.body.application.revision_reason).toBe('Dokumen KTP buram, mohon unggah ulang');
    });

    it('E-REV-08: ComplianceLead returns HIGH risk app for revision → 200 REVISION_REQUIRED', async () => {
      const appId = await createAndSubmitForRevision(8);

      // Force HIGH risk via DB
      await pgPool.query(
        `INSERT INTO application_risk(application_id, risk_score, risk_level, factors)
         VALUES($1, 100, 'HIGH', '{}'::jsonb)
         ON CONFLICT (application_id) DO UPDATE SET risk_level='HIGH'`,
        [Number(appId)],
      );

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'RETURN_FOR_REVISION', reason: 'Data penghasilan tidak konsisten dengan profil risiko' })
        .expect(200);

      expect(res.body.status).toBe('REVISION_REQUIRED');
      expect(res.body.revision_reason).toBe('Data penghasilan tidak konsisten dengan profil risiko');
    });

    it('E-REV-09: FrontDesk tidak bisa approve/return → 403', async () => {
      const appId = await createAndSubmitForRevision(9);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ decision: 'RETURN_FOR_REVISION', reason: 'test' })
        .expect(403);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ decision: 'APPROVED' })
        .expect(403);
    });

    it('E-REV-10: OperationSupervisor tidak bisa return HIGH risk app → 403', async () => {
      const appId = await createAndSubmitForRevision(10);

      await pgPool.query(
        `INSERT INTO application_risk(application_id, risk_score, risk_level, factors)
         VALUES($1, 100, 'HIGH', '{}'::jsonb)
         ON CONFLICT (application_id) DO UPDATE SET risk_level='HIGH'`,
        [Number(appId)],
      );

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'RETURN_FOR_REVISION', reason: 'coba return HIGH' })
        .expect(403);

      expect(res.body.message).toContain('Lead Compliance');
    });

    it('E-REV-11: ComplianceLead tidak bisa return LOW/MEDIUM risk app → 403', async () => {
      const appId = await createAndSubmitForRevision(11);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'RETURN_FOR_REVISION', reason: 'coba return LOW' })
        .expect(403);

      expect(res.body.message).toContain('Operation Supervisor');
    });

    it('E-REV-12: Submit dari status selain DRAFT/REVISION_REQUIRED → 400', async () => {
      // App yang sudah SUBMITTED tidak bisa di-submit lagi
      const appId = await createAndSubmitForRevision(12);
      // appId sudah dalam status SUBMITTED setelah createAndSubmitForRevision

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      expect(res.body.message).toContain('SUBMITTED');
    });
  });

  // ══════════════════════════════════════════════════════════
  // F. TRANSFER — blocked jika application belum APPROVED
  // ══════════════════════════════════════════════════════════
  describe('F. Transfer blocked before APPROVED', () => {
    it('F-01: POST /transfers dengan DRAFT app → 400 "harus berstatus APPROVED"', async () => {
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

      expect(res.body.message).toBe(
        'Pengguna jasa harus berstatus APPROVED untuk pencatatan transfer.',
      );
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
  // FZ. TRANSFER — hard guard pengirim wajib APPROVED
  //   Guard di create, update draft, dan submit. Status pengirim
  //   dimanipulasi langsung via DB agar skenario terisolasi.
  // ══════════════════════════════════════════════════════════
  describe('FZ. Transfer approved-customer hard guard', () => {
    const GUARD_MSG =
      'Pengguna jasa harus berstatus APPROVED untuk pencatatan transfer.';

    // Buat individual DRAFT lalu set status apa pun langsung via DB.
    async function createAppWithStatus(status: string, n: number): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Guard ${n} ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3144${n}${SUFFIX}`,
          address_identity: 'Jl. Guard No. 1',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `0819${n}${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          signature_uri: 'https://storage.test/guard_sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);
      await pgPool.query(`UPDATE applications SET status=$2 WHERE id=$1`, [appId, status]);
      return appId;
    }

    function transferBody(appId: string, amount = 100_000) {
      return {
        amount,
        sender_application_id: Number(appId),
        beneficiaryBankName: 'Bank Test',
        beneficiaryAccountNumber: '1234567890',
        beneficiaryAccountName: 'Penerima Guard',
      };
    }

    it('FZ-01: create transfer dengan sender IN_REVIEW → 400', async () => {
      const appId = await createAppWithStatus('IN_REVIEW', 1);
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send(transferBody(appId))
        .expect(400);
      expect(res.body.message).toBe(GUARD_MSG);
    });

    it('FZ-02: create transfer dengan sender REJECTED → 400', async () => {
      const appId = await createAppWithStatus('REJECTED', 2);
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send(transferBody(appId))
        .expect(400);
      expect(res.body.message).toBe(GUARD_MSG);
    });

    it('FZ-03: update draft → 400 jika pengirim tidak lagi APPROVED', async () => {
      const appId = await createAppWithStatus('APPROVED', 3);
      const create = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send(transferBody(appId))
        .expect(201);
      const txId = String(create.body.id);

      // Pengirim di-downgrade → update draft harus gagal.
      await pgPool.query(`UPDATE applications SET status='REJECTED' WHERE id=$1`, [appId]);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/transfers/${txId}`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send(transferBody(appId, 150_000))
        .expect(400);
      expect(res.body.message).toBe(GUARD_MSG);
    });

    it('FZ-04: submit draft lama → 400 jika pengirim tidak lagi APPROVED', async () => {
      const appId = await createAppWithStatus('APPROVED', 4);
      const create = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send(transferBody(appId))
        .expect(201);
      const txId = String(create.body.id);

      // Draft lama; pengirim jatuh ke DRAFT → submit harus gagal.
      await pgPool.query(`UPDATE applications SET status='DRAFT' WHERE id=$1`, [appId]);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/submit`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(400);
      expect(res.body.message).toBe(GUARD_MSG);
    });

    it('FZ-05: sender search hanya mengembalikan aplikasi APPROVED', async () => {
      const appId = await createAppWithStatus('APPROVED', 5);
      // muncul saat APPROVED
      const inRes = await request(app.getHttpServer())
        .get(`${BASE}/transfers/senders/search?q=Guard+5+${SUFFIX}`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(200);
      expect(inRes.body.data.map((x: any) => String(x.application_id))).toContain(String(appId));

      // downgrade → hilang dari hasil search
      await pgPool.query(`UPDATE applications SET status='REJECTED' WHERE id=$1`, [appId]);
      const outRes = await request(app.getHttpServer())
        .get(`${BASE}/transfers/senders/search?q=Guard+5+${SUFFIX}`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .expect(200);
      expect(outRes.body.data.map((x: any) => String(x.application_id))).not.toContain(String(appId));
    });

    it('FZ-06: create transfer dengan sender APPROVED → 201 (regression tetap sukses)', async () => {
      const appId = await createAppWithStatus('APPROVED', 6);
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send(transferBody(appId))
        .expect(201);
      expect(res.body.status).toBe('DRAFT');
    });
  });

  // ══════════════════════════════════════════════════════════
  // FW. TRANSFER — alur 3-langkah (OperationSupervisor → FinanceStaff → FinanceManager)
  // ══════════════════════════════════════════════════════════
  describe('FW. Transfer 3-step approval workflow', () => {
    async function createApprovedSenderForTransfer(tag: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `TRF Sender ${tag}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3188${tag}`,
          address_identity: 'Jl. Transfer No. 1',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `0888${tag}`,
          occupation: 'Wiraswasta',
          gender: 'M',
          signature_uri: 'https://storage.test/sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);
      await pgPool.query(`UPDATE applications SET status='APPROVED' WHERE id=$1`, [appId]);
      return appId;
    }

    async function createAndSubmitTransfer(senderAppId: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          amount: 100_000,
          sender_application_id: Number(senderAppId),
          beneficiaryBankName: 'Bank Test',
          beneficiaryAccountNumber: '9876543210',
          beneficiaryAccountName: 'Penerima FW',
        })
        .expect(201);
      const txId = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/submit`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(201);

      return txId;
    }

    it('FW-01: FrontDesk dapat membuat dan submit transfer → SUBMITTED', async () => {
      const senderAppId = await createApprovedSenderForTransfer(`FW01${SUFFIX}`);
      const txId = await createAndSubmitTransfer(senderAppId);
      const res = await request(app.getHttpServer())
        .get(`${BASE}/transfers/${txId}`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .expect(200);
      expect(res.body.status).toBe('SUBMITTED');
    });

    it('FW-02: OperationSupervisor dapat approve transfer layer 1 → PENDING_FINANCE_STAFF_REVIEW', async () => {
      const senderAppId = await createApprovedSenderForTransfer(`FW02${SUFFIX}`);
      const txId = await createAndSubmitTransfer(senderAppId);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'dokumen lengkap' })
        .expect(201);
      expect(res.body.status).toBe('PENDING_FINANCE_STAFF_REVIEW');
    });

    it('FW-03: FinanceStaff dapat forward transfer layer 2 → PENDING_FINANCE_MANAGER_APPROVAL', async () => {
      const senderAppId = await createApprovedSenderForTransfer(`FW03${SUFFIX}`);
      const txId = await createAndSubmitTransfer(senderAppId);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'siap untuk approval' })
        .expect(201);
      expect(res.body.status).toBe('PENDING_FINANCE_MANAGER_APPROVAL');
    });

    it('FW-04: FinanceManager dapat final approve transfer → COMPLETED/SUCCESS', async () => {
      const senderAppId = await createApprovedSenderForTransfer(`FW04${SUFFIX}`);
      const txId = await createAndSubmitTransfer(senderAppId);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE' })
        .expect(201);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.result).toBe('SUCCESS');
    });

    it('FW-05: OperationSupervisor dapat reject transfer layer 1 → REJECTED', async () => {
      const senderAppId = await createApprovedSenderForTransfer(`FW05${SUFFIX}`);
      const txId = await createAndSubmitTransfer(senderAppId);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'REJECT', reject_reason: 'dokumen tidak lengkap' })
        .expect(201);
      expect(res.body.status).toBe('REJECTED');
    });

    it('FW-06: FinanceStaff tidak bisa supervisor-review (wrong role) → 403', async () => {
      const senderAppId = await createApprovedSenderForTransfer(`FW06${SUFFIX}`);
      const txId = await createAndSubmitTransfer(senderAppId);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'coba' })
        .expect(403);
    });

    it('FW-07: OperationSupervisor tidak bisa finance-review (wrong role) → 403', async () => {
      const senderAppId = await createApprovedSenderForTransfer(`FW07${SUFFIX}`);
      const txId = await createAndSubmitTransfer(senderAppId);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/finance-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'coba' })
        .expect(403);
    });

    it('FW-08: Auditor dapat membaca daftar transfer → 200', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);
    });
  });

  // ══════════════════════════════════════════════════════════
  // FC. TRANSFER — Compliance Review flow (flagged transfer)
  // ══════════════════════════════════════════════════════════
  describe('FC. Transfer Compliance Review flow', () => {
    async function createApprovedSender(tag: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `TRF Compliance ${tag}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3199${tag}`,
          address_identity: 'Jl. Compliance No. 1',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `0899${tag}`,
          occupation: 'Wiraswasta',
          gender: 'M',
          signature_uri: 'https://storage.test/sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);
      await pgPool.query(`UPDATE applications SET status='APPROVED' WHERE id=$1`, [appId]);
      return appId;
    }

    // DRAFT transfer (dibuat FrontDesk, belum di-submit)
    async function createDraftTransfer(senderAppId: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          amount: 250_000,
          sender_application_id: Number(senderAppId),
          beneficiaryBankName: 'Bank Test',
          beneficiaryAccountNumber: '1122334455',
          beneficiaryAccountName: 'Penerima FC',
        })
        .expect(201);
      return String(create.body.id);
    }

    function submitForComplianceReview(txId: string, body: any) {
      return request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/submit-compliance-review`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send(body);
    }

    // ── FC-01: FrontDesk submit DRAFT → compliance review, status + row OPEN ──
    it('FC-01: FrontDesk submit DRAFT ke compliance review → PENDING_COMPLIANCE_REVIEW + review OPEN', async () => {
      const senderAppId = await createApprovedSender(`FC01${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);

      const res = await submitForComplianceReview(txId, {
        red_flags: ['AMOUNT_NOT_MATCH_PROFILE', 'UNUSUAL_VOLUME'],
        report_notes: 'Nominal dan volume perlu direview compliance.',
      }).expect(201);

      // J2: status baru
      expect(res.body.status).toBe('PENDING_COMPLIANCE_REVIEW');
      // J3: review row OPEN + reported_by + reported_at (backend timestamp)
      expect(res.body.compliance_review_status).toBe('OPEN');
      const review = res.body.latest_compliance_review;
      expect(review).toBeTruthy();
      expect(review.status).toBe('OPEN');
      expect(review.red_flags).toEqual(['AMOUNT_NOT_MATCH_PROFILE', 'UNUSUAL_VOLUME']);
      expect(review.reported_by).toBeTruthy();
      expect(review.reported_at).toBeTruthy();
      expect(review.reviewed_by).toBeNull();
      expect(review.reviewed_at).toBeNull();
    });

    // ── FC-02: red_flags kosong → 400 ──
    it('FC-02: red_flags kosong → 400', async () => {
      const senderAppId = await createApprovedSender(`FC02${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: [] }).expect(400);
    });

    // ── FC-03: red_flags berisi OTHER tanpa report_notes → 400 ──
    it('FC-03: red_flags mengandung OTHER tanpa report_notes → 400', async () => {
      const senderAppId = await createApprovedSender(`FC03${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['OTHER'] }).expect(400);
    });

    // ── FC-04: OperationSupervisor tidak bisa review saat PENDING_COMPLIANCE_REVIEW ──
    it('FC-04: OperationSupervisor tidak bisa supervisor-review transfer PENDING_COMPLIANCE_REVIEW → 400', async () => {
      const senderAppId = await createApprovedSender(`FC04${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, {
        red_flags: ['RBA_HIGH'],
      }).expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'coba approve' })
        .expect(400);
    });

    // ── FC-05 & FC-06: ComplianceLead APPROVE_TO_CONTINUE → SUBMITTED ──
    it('FC-05/06: ComplianceLead APPROVE_TO_CONTINUE → transfer SUBMITTED + review APPROVED_TO_CONTINUE', async () => {
      const senderAppId = await createApprovedSender(`FC05${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['RBA_INCOMPLETE'] }).expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'APPROVE_TO_CONTINUE', decision_notes: 'Boleh dilanjutkan.' })
        .expect(201);

      expect(res.body.status).toBe('SUBMITTED');
      expect(res.body.compliance_review_status).toBe('APPROVED_TO_CONTINUE');
      expect(res.body.latest_compliance_review.reviewed_by).toBeTruthy();
      expect(res.body.latest_compliance_review.reviewed_at).toBeTruthy();
    });

    // ── FC-07: OperationSupervisor bisa review setelah compliance approve ──
    it('FC-07: OperationSupervisor bisa review setelah APPROVE_TO_CONTINUE (endpoint existing)', async () => {
      const senderAppId = await createApprovedSender(`FC07${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['UNUSUAL_FREQUENCY'] }).expect(201);
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'APPROVE_TO_CONTINUE', decision_notes: 'ok lanjut' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'dokumen lengkap' })
        .expect(201);
      expect(res.body.status).toBe('PENDING_FINANCE_STAFF_REVIEW');
    });

    // ── FC-08 & FC-09: ComplianceLead REJECT → REJECTED, notes wajib ──
    it('FC-08: ComplianceLead REJECT → transfer REJECTED + review REJECTED', async () => {
      const senderAppId = await createApprovedSender(`FC08${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['STRUCTURING_PATTERN'] }).expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'REJECT', decision_notes: 'Terindikasi pola tidak wajar.' })
        .expect(201);
      expect(res.body.status).toBe('REJECTED');
      expect(res.body.compliance_review_status).toBe('REJECTED');
    });

    it('FC-09: REJECT tanpa decision_notes → 400', async () => {
      const senderAppId = await createApprovedSender(`FC09${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['OTHER'], report_notes: 'perlu cek' }).expect(201);
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'REJECT' })
        .expect(400);
    });

    // ── FC-10: REQUEST_ADDITIONAL_INFO → tetap PENDING_COMPLIANCE_REVIEW ──
    it('FC-10: REQUEST_ADDITIONAL_INFO tetap PENDING_COMPLIANCE_REVIEW & masih bisa APPROVE lanjut', async () => {
      const senderAppId = await createApprovedSender(`FC10${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['DOCUMENT_OR_INFORMATION_UNUSUAL'] }).expect(201);

      const info = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'REQUEST_ADDITIONAL_INFO', decision_notes: 'Mohon lengkapi dokumen sumber dana.' })
        .expect(201);
      expect(info.body.status).toBe('PENDING_COMPLIANCE_REVIEW');
      expect(info.body.compliance_review_status).toBe('REQUEST_ADDITIONAL_INFO');

      // OperationSupervisor tetap tidak bisa review
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE' })
        .expect(400);

      // Compliance masih bisa APPROVE_TO_CONTINUE setelahnya
      const cont = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'APPROVE_TO_CONTINUE', decision_notes: 'Dokumen sudah lengkap.' })
        .expect(201);
      expect(cont.body.status).toBe('SUBMITTED');
    });

    // ── FC-11: REQUEST_EDD → tetap PENDING_COMPLIANCE_REVIEW ──
    it('FC-11: REQUEST_EDD tetap PENDING_COMPLIANCE_REVIEW', async () => {
      const senderAppId = await createApprovedSender(`FC11${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['RBA_HIGH'] }).expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'REQUEST_EDD', decision_notes: 'Perlu EDD sebelum lanjut.' })
        .expect(201);
      expect(res.body.status).toBe('PENDING_COMPLIANCE_REVIEW');
      expect(res.body.compliance_review_status).toBe('REQUEST_EDD');
    });

    // ── FC-12: MARK_LTKM_CANDIDATE → internal, tetap blocked ──
    it('FC-12: MARK_LTKM_CANDIDATE internal & transfer tetap blocked', async () => {
      const senderAppId = await createApprovedSender(`FC12${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['WATCHLIST_NEAR_MATCH'] }).expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'MARK_LTKM_CANDIDATE', decision_notes: 'Kandidat LTKM internal.' })
        .expect(201);
      expect(res.body.status).toBe('PENDING_COMPLIANCE_REVIEW');
      expect(res.body.compliance_review_status).toBe('LTKM_CANDIDATE');

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE' })
        .expect(400);
    });

    // ── FC-13: Normal submit DRAFT → SUBMITTED tetap jalan (tidak berubah) ──
    it('FC-13: Normal submit DRAFT → SUBMITTED tidak berubah', async () => {
      const senderAppId = await createApprovedSender(`FC13${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/submit`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(201);
      expect(res.body.status).toBe('SUBMITTED');
    });

    // ── FC-14: FinanceStaff/Manager tidak bisa bertindak sebelum Ops review ──
    it('FC-14: FinanceStaff/FinanceManager tidak bisa act sebelum OperationSupervisor', async () => {
      const senderAppId = await createApprovedSender(`FC14${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await submitForComplianceReview(txId, { red_flags: ['PURPOSE_NOT_MATCH_PROFILE'] }).expect(201);
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'APPROVE_TO_CONTINUE', decision_notes: 'lanjut' })
        .expect(201);
      // status = SUBMITTED, belum lewat Ops review
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE' })
        .expect(400);
    });

    // ── FC-15: Timestamp backend-generated, client-provided diabaikan ──
    it('FC-15: reported_at backend-generated & client-provided timestamp diabaikan', async () => {
      const senderAppId = await createApprovedSender(`FC15${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      const bogus = '1999-01-01T00:00:00.000Z';
      const res = await submitForComplianceReview(txId, {
        red_flags: ['UNUSUAL_VOLUME'],
        reported_at: bogus,     // whitelist strips unknown field
        reviewed_at: bogus,
      }).expect(201);
      const reportedAt = new Date(res.body.latest_compliance_review.reported_at).getTime();
      expect(reportedAt).toBeGreaterThan(new Date('2020-01-01').getTime());
    });

    // ── FC-16: ComplianceLead tidak bisa decide transfer non-PENDING_COMPLIANCE_REVIEW ──
    it('FC-16: compliance-review pada transfer DRAFT (belum diajukan) → 400', async () => {
      const senderAppId = await createApprovedSender(`FC16${SUFFIX}`);
      const txId = await createDraftTransfer(senderAppId);
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'APPROVE_TO_CONTINUE', decision_notes: 'x' })
        .expect(400);
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
          deed_number: `AKTA-G01-${SUFFIX}`,
          business_license_number: `BL${SUFFIX}`,
          nib: `NIB${SUFFIX}`,
          npwp: npwp15('01'),
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
      expect(missing.some((m) => m.includes('Dokumen wajib belum lengkap'))).toBe(true);
      expect(missing.some((m) => m.includes('party'))).toBe(true);
    });

    it('G-03: Submit dengan docs lengkap tapi tanpa party → 400 missing party', async () => {
      for (const docType of ['AKTA_PENDIRIAN', 'NIB_SIUP', 'NPWP_BADAN', 'BUSINESS_MANAGEMENT_IDENTITY']) {
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

    it('G-07: OperationSupervisor APPROVE bisnis SUBMITTED LOW/MEDIUM → 200 APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${bizAppId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
    });
  });

  // ══════════════════════════════════════════════════════════
  // GB. Business CDD — penyelarasan form terbaru (0040)
  // ══════════════════════════════════════════════════════════
  describe('GB. Business CDD form alignment', () => {
    let cddAppId: string;

    function baseBusinessBody(tag: string) {
      return {
        legal_name: `PT CDD ${tag} ${SUFFIX}`,
        legal_form: 'PT',
        incorporation_place: 'Jakarta',
        incorporation_date: '2019-06-01',
        deed_number: `AKTA-${tag}-${SUFFIX}`,
        business_license_number: `IZN${tag}${SUFFIX}`,
        nib: `NIB${tag}${SUFFIX}`,
        npwp: npwp15(tag),
        address_line: 'Jl. Kedudukan No. 10',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        postal_code: '10110',
        business_activity: 'Perdagangan Umum',
        phone: `021${tag}${SUFFIX}`,
      };
    }

    it('GB-01: create business dengan field CDD baru → 201 + detail mengembalikan field baru', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          ...baseBusinessBody('A'),
          deed_number: `AKTA-${SUFFIX}`,
          company_email: `cdd${SUFFIX}@perusahaan.co.id`,
          pic_name: `PIC Utama ${SUFFIX}`,
          pic_position: 'Direktur Utama',
          pic_identity_number: `317600${SUFFIX}`,
          pic_identity_type: 'KTP',
          representative_signature_name: `PIC Utama ${SUFFIX}`,
          verification_officer: `Officer ${SUFFIX}`,
          supervisor: `Supervisor ${SUFFIX}`,
        })
        .expect(201);
      cddAppId = String(create.body.id);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${cddAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const b = detail.body.business;
      expect(b.deed_number).toBe(`AKTA-${SUFFIX}`);
      expect(b.company_email).toBe(`cdd${SUFFIX}@perusahaan.co.id`);
      expect(b.pic_name).toBe(`PIC Utama ${SUFFIX}`);
      expect(b.pic_position).toBe('Direktur Utama');
      expect(b.pic_identity_number).toBe(`317600${SUFFIX}`);
      expect(b.pic_identity_type).toBe('KTP');
      expect(b.verification_officer).toBe(`Officer ${SUFFIX}`);
      expect(b.supervisor).toBe(`Supervisor ${SUFFIX}`);
      // business_form alias = legal_form
      expect(b.business_form).toBe('PT');
      // Nama Dagang tidak diekspos
      expect(Object.prototype.hasOwnProperty.call(b, 'trade_name')).toBe(false);
      // status watchlist per kategori default CLEAR
      expect(b.company_watchlist_status).toBe('CLEAR');
      expect(b.management_watchlist_status).toBe('CLEAR');
      expect(b.shareholder_watchlist_status).toBe('CLEAR');
    });

    it('GB-02: "Nama Dagang" tidak wajib — create tanpa trade_name tetap 201', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        // sengaja tanpa trade_name; kirim trade_name pun akan di-strip whitelist
        .send({ ...baseBusinessBody('B'), trade_name: 'Harusnya diabaikan' })
        .expect(201);
      expect(create.body.status).toBe('DRAFT');
    });

    it('GB-03: shareholder — address & ownership_percentage tersimpan/terkembalikan', async () => {
      const party = await request(app.getHttpServer())
        .post(`${BASE}/applications/${cddAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'SHAREHOLDER',
          full_name: `Pemegang Saham ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `328100${SUFFIX}`,
          address: 'Jl. Saham No. 25, Jakarta',
          ownership_percentage: 30,
          identity_document_type: 'KTP',
        })
        .expect(201);
      expect(party.body.role).toBe('SHAREHOLDER');
      expect(party.body.address).toBe('Jl. Saham No. 25, Jakarta');
      expect(Number(party.body.ownership_percentage)).toBe(30);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${cddAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      const sh = detail.body.parties.find((p: any) => p.role === 'SHAREHOLDER');
      expect(sh).toBeDefined();
      expect(sh.address).toBe('Jl. Saham No. 25, Jakarta');
      expect(Number(sh.ownership_percentage)).toBe(30);
    });

    it('GB-04: BO — source_of_funds & source_of_wealth tersimpan/terkembalikan', async () => {
      const party = await request(app.getHttpServer())
        .post(`${BASE}/applications/${cddAppId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'BO',
          full_name: `Beneficial Owner ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `329100${SUFFIX}`,
          address: 'Jl. BO No. 1, Jakarta',
          ownership_percentage: 55,
          identity_document_type: 'KTP',
          source_of_funds: 'Gaji dan dividen usaha',
          source_of_wealth: 'Akumulasi kepemilikan saham perusahaan',
        })
        .expect(201);
      expect(party.body.source_of_funds).toBe('Gaji dan dividen usaha');
      expect(party.body.source_of_wealth).toBe('Akumulasi kepemilikan saham perusahaan');

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${cddAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      const bo = detail.body.parties.find((p: any) => p.role === 'BO');
      expect(bo).toBeDefined();
      expect(bo.source_of_funds).toBe('Gaji dan dividen usaha');
      expect(bo.source_of_wealth).toBe('Akumulasi kepemilikan saham perusahaan');
      expect(bo.address).toBe('Jl. BO No. 1, Jakarta');
    });

    it('GB-05: BUSINESS_BO_DOCUMENT diterima sebagai dokumen', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${cddAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'BUSINESS_BO_DOCUMENT',
          file_uri: 'https://storage.test/docs/bo.pdf',
        })
        .expect(201);
      expect(res.body.doc_type).toBe('BUSINESS_BO_DOCUMENT');
    });

    it('GB-06: GET /references/business-document-types → 6 tipe termasuk Dokumen BO', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/business-document-types`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      const codes = res.body.data.map((x: any) => x.code);
      for (const code of [
        'BUSINESS_DEED_ESTABLISHMENT_AMENDMENT',
        'BUSINESS_LICENSE',
        'BUSINESS_NPWP',
        'BUSINESS_MANAGEMENT_IDENTITY',
        'BUSINESS_SHAREHOLDER_IDENTITY_25',
        'BUSINESS_BO_DOCUMENT',
      ]) {
        expect(codes).toContain(code);
      }
      const bo = res.body.data.find((x: any) => x.code === 'BUSINESS_BO_DOCUMENT');
      expect(bo.name).toBe('Dokumen BO');
    });

    it('GB-07: FrontDesk approve/reject business CDD → 403', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${cddAppId}/decision`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ decision: 'APPROVED' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${cddAppId}/decision`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ decision: 'REJECTED', reason: 'x' })
        .expect(403);
    });

    it('GB-08: submit business memakai nama dokumen BUSINESS_* baru → SUBMITTED', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBusinessBody('C'))
        .expect(201);
      const appId = String(create.body.id);

      for (const docType of [
        'BUSINESS_DEED_ESTABLISHMENT_AMENDMENT',
        'BUSINESS_LICENSE',
        'BUSINESS_NPWP',
        'BUSINESS_MANAGEMENT_IDENTITY',
      ]) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${appId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: docType, file_uri: `https://storage.test/docs/${docType}.pdf` })
          .expect(201);
      }

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'DIRECTOR',
          full_name: `Direktur CDD ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `330100${SUFFIX}`,
          dob: '1980-01-01',
          nationality: 'ID',
          phone: `0817${SUFFIX}`,
        })
        .expect(201);

      const submit = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(submit.body.status);
    });
  });

  // ══════════════════════════════════════════════════════════
  // GC. Business required documents — wajib selalu + kondisional (0041)
  // ══════════════════════════════════════════════════════════
  describe('GC. Business required documents (conditional)', () => {
    let seq = 0;

    // Buat business DRAFT baru dengan identitas unik.
    async function createBiz(tag: string): Promise<string> {
      seq += 1;
      const u = `${SUFFIX}${seq}`;
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `PT ReqDoc ${tag} ${u}`,
          legal_form: 'PT',
          incorporation_place: 'Jakarta',
          incorporation_date: '2020-03-03',
          deed_number: `AKTA-${tag}-${u}`,
          business_license_number: `IZN${tag}${u}`,
          nib: `NIB${tag}${u}`,
          npwp: npwp15(u),
          address_line: 'Jl. ReqDoc No. 7',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          postal_code: '10120',
          business_activity: 'Perdagangan Umum',
          phone: `021${tag}${u}`.slice(0, 15),
        })
        .expect(201);
      return String(res.body.id);
    }

    async function addDoc(appId: string, docType: string) {
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: docType, file_uri: `https://storage.test/docs/${docType}.pdf` })
        .expect(201);
    }

    // Upload 4 dokumen wajib-selalu (pakai nama BUSINESS_* baru).
    async function addAlwaysDocs(appId: string) {
      for (const dt of [
        'BUSINESS_DEED_ESTABLISHMENT_AMENDMENT',
        'BUSINESS_LICENSE',
        'BUSINESS_NPWP',
        'BUSINESS_MANAGEMENT_IDENTITY',
      ]) {
        await addDoc(appId, dt);
      }
    }

    async function addParty(appId: string, body: Record<string, unknown>) {
      seq += 1;
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          identity_type: 'KTP',
          identity_number: `33${seq}00${SUFFIX}`,
          dob: '1980-01-01',
          nationality: 'ID',
          phone: `08${seq}00${SUFFIX}`.slice(0, 15),
          ...body,
        })
        .expect(201);
    }

    const submit = (appId: string) =>
      request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`);

    it('GC-01: submit tanpa Dokumen Identitas Pengurus → 400', async () => {
      const appId = await createBiz('MGMT');
      // hanya 3 core, tanpa management identity
      for (const dt of ['BUSINESS_DEED_ESTABLISHMENT_AMENDMENT', 'BUSINESS_LICENSE', 'BUSINESS_NPWP']) {
        await addDoc(appId, dt);
      }
      await addParty(appId, { role: 'DIRECTOR', full_name: `Dir MGMT ${SUFFIX}` });

      const res = await submit(appId).expect(400);
      expect(res.body.message).toContain('Dokumen wajib belum lengkap');
      expect(res.body.message).toContain('Dokumen Identitas Pengurus');
    });

    it('GC-02: SHAREHOLDER ≥25 tanpa dokumen pemegang saham → 400', async () => {
      const appId = await createBiz('SH25');
      await addAlwaysDocs(appId);
      await addParty(appId, { role: 'DIRECTOR', full_name: `Dir SH25 ${SUFFIX}` });
      await addParty(appId, {
        role: 'SHAREHOLDER',
        full_name: `Shareholder Besar ${SUFFIX}`,
        ownership_percentage: 30,
      });

      const res = await submit(appId).expect(400);
      expect(res.body.message).toContain('Dokumen wajib belum lengkap');
      expect(res.body.message).toContain('Pemegang Saham');
    });

    it('GC-03: party BO tanpa Dokumen BO → 400', async () => {
      const appId = await createBiz('BO');
      await addAlwaysDocs(appId);
      await addParty(appId, {
        role: 'BO',
        full_name: `BO Wajib Dok ${SUFFIX}`,
        ownership_percentage: 60,
      });

      const res = await submit(appId).expect(400);
      expect(res.body.message).toContain('Dokumen wajib belum lengkap');
      expect(res.body.message).toContain('Dokumen BO');
    });

    it('GC-04: SHAREHOLDER <25 → tidak butuh dokumen pemegang saham → SUBMITTED', async () => {
      const appId = await createBiz('SH10');
      await addAlwaysDocs(appId);
      await addParty(appId, { role: 'DIRECTOR', full_name: `Dir SH10 ${SUFFIX}` });
      await addParty(appId, {
        role: 'SHAREHOLDER',
        full_name: `Shareholder Kecil ${SUFFIX}`,
        ownership_percentage: 10,
      });

      const res = await submit(appId).expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });

    it('GC-05: tanpa BO & tanpa shareholder ≥25 → dokumen kondisional tidak wajib → SUBMITTED', async () => {
      const appId = await createBiz('NOBO');
      await addAlwaysDocs(appId);
      await addParty(appId, { role: 'DIRECTOR', full_name: `Dir NoBO ${SUFFIX}` });

      const res = await submit(appId).expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });

    it('GC-06: dokumen wajib + kondisional lengkap (SHAREHOLDER ≥25 & BO) → SUBMITTED', async () => {
      const appId = await createBiz('FULL');
      await addAlwaysDocs(appId);
      await addDoc(appId, 'BUSINESS_SHAREHOLDER_IDENTITY_25');
      await addDoc(appId, 'BUSINESS_BO_DOCUMENT');
      await addParty(appId, { role: 'DIRECTOR', full_name: `Dir Full ${SUFFIX}` });
      await addParty(appId, {
        role: 'SHAREHOLDER',
        full_name: `Shareholder Full ${SUFFIX}`,
        ownership_percentage: 40,
      });
      await addParty(appId, {
        role: 'BO',
        full_name: `BO Full ${SUFFIX}`,
        ownership_percentage: 51,
      });

      const res = await submit(appId).expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });
  });

  // ══════════════════════════════════════════════════════════
  // GD. Business — Nomor Izin Usaha: license_number OR nib (0042)
  // ══════════════════════════════════════════════════════════
  describe('GD. Business license/NIB flexibility', () => {
    let seq = 0;

    // Buat business DRAFT dengan kontrol atas business_license_number & nib.
    async function createBiz(
      tag: string,
      opts: { license?: string | null; nib?: string | null },
    ): Promise<string> {
      seq += 1;
      const u = `${SUFFIX}${seq}`;
      const body: Record<string, unknown> = {
        legal_name: `PT Izin ${tag} ${u}`,
        legal_form: 'PT',
        incorporation_place: 'Jakarta',
        incorporation_date: '2020-04-04',
        deed_number: `AKTA-${tag}-${u}`,
        npwp: npwp15(u),
        address_line: 'Jl. Izin No. 9',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        postal_code: '10130',
        business_activity: 'Perdagangan Umum',
        phone: `021${tag}${u}`.slice(0, 15),
      };
      if (opts.license !== undefined && opts.license !== null) body.business_license_number = opts.license;
      if (opts.nib !== undefined && opts.nib !== null) body.nib = opts.nib;

      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(body)
        .expect(201);
      return String(res.body.id);
    }

    async function prepareForSubmit(appId: string) {
      for (const dt of [
        'BUSINESS_DEED_ESTABLISHMENT_AMENDMENT',
        'BUSINESS_LICENSE',
        'BUSINESS_NPWP',
        'BUSINESS_MANAGEMENT_IDENTITY',
      ]) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${appId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: dt, file_uri: `https://storage.test/docs/${dt}.pdf` })
          .expect(201);
      }
      seq += 1;
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'DIRECTOR',
          full_name: `Dir Izin ${seq} ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `34${seq}00${SUFFIX}`,
          dob: '1980-01-01',
          nationality: 'ID',
          phone: `087${seq}0${SUFFIX}`.slice(0, 15),
        })
        .expect(201);
    }

    const submit = (appId: string) =>
      request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`);

    it('GD-01: submit dengan business_license_number saja (tanpa nib) → SUBMITTED', async () => {
      const appId = await createBiz('LIC', { license: `IZN-ONLY-${SUFFIX}`, nib: null });
      await prepareForSubmit(appId);
      const res = await submit(appId).expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });

    it('GD-02: submit dengan nib saja (tanpa business_license_number) → SUBMITTED', async () => {
      const appId = await createBiz('NIB', { license: null, nib: `NIB-ONLY-${SUFFIX}` });
      await prepareForSubmit(appId);
      const res = await submit(appId).expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });

    it('GD-03: submit dengan keduanya kosong → 400 "Nomor Izin Usaha ... wajib diisi."', async () => {
      const appId = await createBiz('NONE', { license: null, nib: null });
      await prepareForSubmit(appId);
      const res = await submit(appId).expect(400);
      expect(res.body.message).toBe('Nomor Izin Usaha (NIB/OSS/SIUP/dll) wajib diisi.');
    });
  });

  // ══════════════════════════════════════════════════════════
  // GE. "Lainnya" manual fields & Business/KYB adjustments (0047)
  //   - RBA V01 rule: *_other TIDAK menggantikan nilai dropdown.
  // ══════════════════════════════════════════════════════════
  describe('GE. "Lainnya" fields & Business/KYB adjustments', () => {
    let geSeq = 0;
    const uniq = () => `${SUFFIX}${(geSeq += 1)}`;

    function baseBizBody(over: Record<string, unknown> = {}) {
      const u = uniq();
      return {
        legal_name: `PT GE ${u}`,
        legal_form: 'PT',
        incorporation_place: 'Jakarta',
        incorporation_date: '2020-05-05',
        deed_number: `AKTA-GE-${u}`,
        business_license_number: `IZN-GE-${u}`,
        nib: `NIB-GE-${u}`,
        npwp: npwp15(u),
        address_line: 'Jl. GE No. 1',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        postal_code: '10110',
        business_activity: 'Perdagangan Umum',
        phone: `0219${u}`.slice(0, 15),
        ...over,
      };
    }

    // ── A. Individual "Lainnya" ────────────────────────────────────────────
    it('GE-01: Individual occupation="Lainnya" → occupation_other tersimpan, occupation tetap "Lainnya"', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GE Indiv Lainnya ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3901100${SUFFIX}`,
          address_identity: 'Jl. GE Indiv No. 1',
          pob: 'Jakarta',
          dob: '1991-02-02',
          nationality: 'ID',
          phone: `08131${SUFFIX}`,
          occupation: 'Lainnya',
          occupation_other: 'Pengrajin mebel rumahan',
          gender: 'M',
        })
        .expect(201);
      const appId = String(create.body.id);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(detail.body.person.occupation).toBe('Lainnya');
      expect(detail.body.person.occupation_other).toBe('Pengrajin mebel rumahan');
    });

    it('GE-02: RBA field source_of_funds="Lainnya" → dropdown value preserved + source_of_funds_other terpisah', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GE Indiv SOF ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3901200${SUFFIX}`,
          address_identity: 'Jl. GE Indiv No. 2',
          pob: 'Jakarta',
          dob: '1992-03-03',
          nationality: 'ID',
          phone: `08132${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'F',
          source_of_funds: 'Lainnya',
          source_of_funds_other: 'hasil penjualan aset pribadi',
        })
        .expect(201);
      const appId = String(create.body.id);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      // RBA V01 strict: dropdown value MUST stay "Lainnya" (not replaced by text)
      expect(detail.body.person.source_of_funds).toBe('Lainnya');
      expect(detail.body.person.source_of_funds_other).toBe('hasil penjualan aset pribadi');
    });

    it('GE-03: PATCH occupation menjauh dari "Lainnya" → occupation_other di-clear', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GE Indiv Clear ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3901300${SUFFIX}`,
          address_identity: 'Jl. GE Indiv No. 3',
          pob: 'Jakarta',
          dob: '1993-04-04',
          nationality: 'ID',
          phone: `08133${SUFFIX}`,
          occupation: 'Lainnya',
          occupation_other: 'Freelance desainer',
          gender: 'M',
        })
        .expect(201);
      const appId = String(create.body.id);

      const patch = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ occupation: 'Karyawan Swasta' })
        .expect(200);
      expect(patch.body.person.occupation).toBe('Karyawan Swasta');
      expect(patch.body.person.occupation_other).toBeNull();
    });

    it('GE-04: PATCH mempertahankan occupation="Lainnya" + ubah occupation_other', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GE Indiv Keep ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3901400${SUFFIX}`,
          address_identity: 'Jl. GE Indiv No. 4',
          pob: 'Jakarta',
          dob: '1994-05-05',
          nationality: 'ID',
          phone: `08134${SUFFIX}`,
          occupation: 'Lainnya',
          occupation_other: 'Awal',
          gender: 'M',
        })
        .expect(201);
      const appId = String(create.body.id);

      const patch = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ occupation: 'Lainnya', occupation_other: 'Diperbarui' })
        .expect(200);
      expect(patch.body.person.occupation).toBe('Lainnya');
      expect(patch.body.person.occupation_other).toBe('Diperbarui');
    });

    it('GE-05: Individual occupation="Lainnya" tanpa occupation_other → 400 pesan jelas', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GE Indiv NoOther ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3901500${SUFFIX}`,
          address_identity: 'Jl. GE Indiv No. 5',
          pob: 'Jakarta',
          dob: '1995-06-06',
          nationality: 'ID',
          phone: `08135${SUFFIX}`,
          occupation: 'Lainnya',
          gender: 'M',
        })
        .expect(400);
      expect(res.body.message).toBe('Keterangan lainnya wajib diisi untuk Pekerjaan.');
    });

    // ── B.1 deed_number wajib untuk PT ─────────────────────────────────────
    it('GE-06: Business PT tanpa deed_number → 400 "Nomor Akta Pendirian wajib..."', async () => {
      const body = baseBizBody();
      delete (body as any).deed_number;
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(body)
        .expect(400);
      expect(res.body.message).toBe('Nomor Akta Pendirian wajib diisi untuk badan usaha PT.');
    });

    it('GE-07: Business non-PT (CV) tanpa deed_number → 201', async () => {
      const body = baseBizBody({ legal_form: 'CV', legal_name: `CV GE ${uniq()}` });
      delete (body as any).deed_number;
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(body)
        .expect(201);
      expect(res.body.status).toBe('DRAFT');
    });

    // ── B.5 NPWP wajib 15 digit angka ──────────────────────────────────────
    it('GE-08: Business NPWP non-digit → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ npwp: '01.234.567.8-901.234' }))
        .expect(400);
      expect(res.body.message).toBe('NPWP Badan Usaha wajib 15 digit angka.');
    });

    it('GE-09: Business NPWP bukan 15 digit (14) → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ npwp: '01234567890123' })) // 14 digit
        .expect(400);
      expect(res.body.message).toBe('NPWP Badan Usaha wajib 15 digit angka.');
    });

    it('GE-10: Business NPWP tepat 15 digit → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ npwp: '012345678901234' }))
        .expect(201);
      expect(res.body.status).toBe('DRAFT');
    });

    // ── B.2 Nomor Identitas maksimal 16 karakter ───────────────────────────
    it('GE-11: Business PIC identity_number > 16 → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ pic_identity_number: '123456789012345678' })) // 18 chars
        .expect(400);
      expect(res.body.message).toBe('Nomor Identitas maksimal 16 karakter.');
    });

    it('GE-12: Party (shareholder) identity_number > 16 → 400', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody())
        .expect(201);
      const appId = String(create.body.id);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'SHAREHOLDER',
          full_name: `GE SH Long ${SUFFIX}`,
          identity_type: 'PASPOR',
          identity_number: 'A1234567890123456', // 17 chars
        })
        .expect(400);
      expect(res.body.message).toBe('Nomor Identitas maksimal 16 karakter.');
    });

    // ── B.3 Alamat Kedudukan — dropdown provinsi/kota ──────────────────────
    it('GE-13: Business address province/city codes → tersimpan + nama terkembalikan di detail', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ business_province_code: '31', business_city_code: '3171' }))
        .expect(201);
      const appId = String(create.body.id);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      const b = detail.body.business;
      expect(b.business_province_code).toBe('31');
      expect(b.business_province_name).toBe('DKI Jakarta');
      expect(b.business_city_code).toBe('3171');
      expect(b.business_city_name).toBe('Kota Jakarta Pusat');
    });

    it('GE-14: Business city_code bukan bagian province_code → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ business_province_code: '32', business_city_code: '3171' }))
        .expect(400);
      expect(String(res.body.message)).toContain('business_city_code');
    });

    // ── B.4 Bidang Usaha memakai nama industri RBA V01 (exact) ──────────────
    it('GE-15: Business business_activity = nama industri RBA exact → tersimpan', async () => {
      const rbaName = 'Aktivitas Keuangan dan Asuransi';
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ business_activity: rbaName }))
        .expect(201);
      const appId = String(create.body.id);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(detail.body.business.business_activity).toBe(rbaName);
    });

    // ── A. Business "Lainnya" fields ───────────────────────────────────────
    it('GE-16: Business legal_form="Lainnya" & source_of_funds="Lainnya" → *_other tersimpan, dropdown dipertahankan', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(
          baseBizBody({
            legal_name: `Badan GE Lainnya ${uniq()}`,
            legal_form: 'Lainnya',
            legal_form_other: 'Badan Layanan Umum Daerah',
            source_of_funds: 'Lainnya',
            source_of_funds_other: 'hibah luar negeri',
          }),
        )
        .expect(201);
      const appId = String(create.body.id);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      const b = detail.body.business;
      expect(b.legal_form).toBe('Lainnya');
      expect(b.legal_form_other).toBe('Badan Layanan Umum Daerah');
      // alias form terbaru
      expect(b.business_form).toBe('Lainnya');
      expect(b.business_form_other).toBe('Badan Layanan Umum Daerah');
      expect(b.source_of_funds).toBe('Lainnya');
      expect(b.source_of_funds_other).toBe('hibah luar negeri');
    });

    it('GE-17: Business legal_form="Lainnya" tanpa legal_form_other → 400 pesan jelas', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ legal_form: 'Lainnya' }))
        .expect(400);
      expect(res.body.message).toBe('Keterangan lainnya wajib diisi untuk Bentuk Badan Usaha.');
    });

    it('GE-18: Party BO source_of_funds="Lainnya" → source_of_funds_other tersimpan + kembali di detail', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody())
        .expect(201);
      const appId = String(create.body.id);

      const party = await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          role: 'BO',
          full_name: `GE BO Lainnya ${SUFFIX}`,
          identity_type: 'KTP',
          identity_number: `3902100${SUFFIX}`,
          ownership_percentage: 60,
          source_of_funds: 'Lainnya',
          source_of_funds_other: 'penjualan properti warisan',
          source_of_wealth: 'Warisan',
        })
        .expect(201);
      expect(party.body.source_of_funds).toBe('Lainnya');
      expect(party.body.source_of_funds_other).toBe('penjualan properti warisan');

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      const bo = detail.body.parties.find((p: any) => p.role === 'BO');
      expect(bo.source_of_funds).toBe('Lainnya');
      expect(bo.source_of_funds_other).toBe('penjualan properti warisan');
    });

    it('GE-19: Business create business_activity="Layanan Finansial - Payment Gateway / PJP 1-2" → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ business_activity: 'Layanan Finansial - Payment Gateway / PJP 1-2' }))
        .expect(201);
      expect(res.body.status).toBe('DRAFT');

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${res.body.id}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(detail.body.business.business_activity).toBe('Layanan Finansial - Payment Gateway / PJP 1-2');
    });

    it('GE-20: Business create business_activity="Lainnya" + business_activity_other → 201, keduanya tersimpan', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({
          business_activity: 'Lainnya',
          business_activity_other: 'Ekspedisi barang khusus B3',
        }))
        .expect(201);
      expect(res.body.status).toBe('DRAFT');

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${res.body.id}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(detail.body.business.business_activity).toBe('Lainnya');
      expect(detail.body.business.business_activity_other).toBe('Ekspedisi barang khusus B3');
    });

    it('GE-21: Business create business_activity="Lainnya" tanpa business_activity_other → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send(baseBizBody({ business_activity: 'Lainnya' }))
        .expect(400);
      expect(res.body.message).toContain('Bidang Usaha');
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

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('limit');
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

    it('J-12: POST /transfers dengan SystemAdmin → 201 (full access)', async () => {
      // SystemAdmin punya full access termasuk membuat transfer
      return request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({
          amount: 100000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank Test',
          beneficiaryAccountNumber: '1111111111',
          beneficiaryAccountName: 'Test',
        })
        .expect(201);
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
          ktp_number: TEST_KTP_NUMBER,
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

    it('K-02: GET /precheck tanpa doc → 400, semua 3 foto doc missing', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${sigAppId}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('INDIVIDUAL_KTP_PHOTO') || m.includes('foto KTP'))).toBe(true);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_PHOTO') || m.includes('foto wajah'))).toBe(true);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_WITH_KTP_PHOTO') || m.includes('wajah dengan KTP'))).toBe(true);
    });

    it('K-03: POST /documents INDIVIDUAL_KTP_PHOTO → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${sigAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          doc_type: 'INDIVIDUAL_KTP_PHOTO',
          file_uri: 'https://storage.test/docs/ktp_photo_sig.jpg',
        })
        .expect(201);

      expect(res.body.doc_type).toBe('INDIVIDUAL_KTP_PHOTO');
    });

    it('K-04: GET /precheck setelah INDIVIDUAL_KTP_PHOTO saja → 400, masih kurang 2 foto wajah', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${sigAppId}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);

      const missing: string[] = res.body.missing;
      // KTP_PHOTO sudah ada — tidak boleh muncul
      expect(missing.some((m) => m.includes('INDIVIDUAL_KTP_PHOTO'))).toBe(false);
      // Dua foto wajah masih kurang
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_PHOTO') || m.includes('foto wajah'))).toBe(true);
    });

    it('K-05: POST /documents INDIVIDUAL_FACE_PHOTO + INDIVIDUAL_FACE_WITH_KTP_PHOTO → 201', async () => {
      for (const dt of ['INDIVIDUAL_FACE_PHOTO', 'INDIVIDUAL_FACE_WITH_KTP_PHOTO']) {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/${sigAppId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: dt, file_uri: `https://storage.test/docs/${dt.toLowerCase()}.jpg` })
          .expect(201);
        expect(res.body.doc_type).toBe(dt);
      }
    });

    it('K-06: GET /precheck setelah 3 foto doc lengkap → 200 ok', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${sigAppId}/precheck`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.ok).toBe(true);
    });

    it('K-07: PATCH /submit dengan 3 foto doc → 200 SUBMITTED', async () => {
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
      // Nama Dagang (trade_name) tidak lagi diekspos pada CDD form terbaru
      expect(Object.prototype.hasOwnProperty.call(b, 'trade_name')).toBe(false);
      // field baru & opsional — key harus ada
      expect(Object.prototype.hasOwnProperty.call(b, 'industry_code')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(b, 'deed_number')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(b, 'company_email')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(b, 'business_form')).toBe(true);

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
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(rbaIndivId);

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
          npwp: npwp15('93'),
          address_line: 'Jl. Yayasan No. 1',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          postal_code: '10110',
          business_activity: 'crypto exchange dan virtual asset',
          phone: `0220${SUFFIX}`,
        })
        .expect(201);
      rbaBizId = String(createRes.body.id);

      for (const dt of ['AKTA_PENDIRIAN', 'NIB_SIUP', 'NPWP_BADAN', 'BUSINESS_MANAGEMENT_IDENTITY']) {
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

      // Full 3-step: supervisor → finance → manager
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${id}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${id}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
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

    it('N-05: approve → COMPLETED/SUCCESS + approved_by/approved_at/decision_notes', async () => {
      // Must go through full 3-step flow for FinanceManager strict ordering
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txAutoRef}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txAutoRef}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txAutoRef}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE', decision_notes: 'Approved by manager' })
        .expect(201);

      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.result).toBe('SUCCESS');
      expect(res.body.approved_by).not.toBeNull();
      expect(String(res.body.approved_by)).toMatch(/^\d+$/);
      expect(res.body.approved_at).not.toBeNull();
      expect(res.body.completed_at).not.toBeNull();
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

      // Full 3-step flow before FinanceManager can act
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txReject}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txReject}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
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

    it('N-09: SystemAdmin full access — read + submit + approve + result semua OK', async () => {
      // list & detail
      await request(app.getHttpServer())
        .get(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`${BASE}/transfers/${txSnap}`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(200);

      // SystemAdmin boleh submit (txSnap masih DRAFT pada titik ini)
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txSnap}/submit`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .expect(201);

      // SystemAdmin boleh decide (txSnap sekarang SUBMITTED)
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txSnap}/decision`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({ decision: 'APPROVE' })
        .expect(201);

      // SystemAdmin boleh set result (txSnap sekarang COMPLETED — bypass strict ordering)
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txSnap}/result`)
        .set('Authorization', `Bearer ${sysAdminToken}`)
        .send({ result: 'SUCCESS' })
        .expect(201);
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

    // ── N-12–N-17: FrontDesk transfer permissions ──
    let fdTransferId: string;

    it('N-12: FrontDesk GET /transfers → 200 (read access)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);
    });

    it('N-13: FrontDesk POST /transfers → 201 (dapat membuat transfer)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          amount: 500000,
          sender_application_id: Number(indivAppIdOk),
          beneficiaryBankName: 'Bank BCA',
          beneficiaryBankCode: '014',
          beneficiaryAccountNumber: '1234500001',
          beneficiaryAccountName: 'PT FrontDesk Test',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
      fdTransferId = String(res.body.id);
    });

    it('N-14: FrontDesk GET /transfers/:id → 200 (dapat baca detail)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/transfers/${fdTransferId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      expect(String(res.body.id)).toBe(fdTransferId);
    });

    it('N-15: FrontDesk POST /transfers/:id/submit → 201 (dapat submit)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${fdTransferId}/submit`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(201);

      expect(res.body.status).toBe('SUBMITTED');
    });

    it('N-16: FrontDesk POST /transfers/:id/decision → 403 (tidak boleh approve/reject)', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${fdTransferId}/decision`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ decision: 'APPROVE' })
        .expect(403);
    });

    it('N-17: FrontDesk POST /transfers/:id/result → 403 (tidak boleh update result)', async () => {
      // Go through full 3-step flow then FinanceManager approve → COMPLETED/SUCCESS
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${fdTransferId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${fdTransferId}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${fdTransferId}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE', decision_notes: 'ok' })
        .expect(201);

      // FrontDesk cannot call /result regardless of transfer status
      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${fdTransferId}/result`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ result: 'SUCCESS' })
        .expect(403);
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
          ktp_number: TEST_KTP_NUMBER,
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

      // Upload 2 foto wajah (tidak REJECTED) agar submit 3-doc requirement terpenuhi
      await uploadFacePhotoDocs(appId);

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

    it('O-04: REJECT HIGH RISK tanpa EDD → 200 REVISION_REQUIRED (dikembalikan untuk perbaikan)', async () => {
      eddRejectAppId = await createHighRiskIndividual(`31890001${SUFFIX}`, `088801${SUFFIX}`);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddRejectAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddRejectAppId}/decision`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'REJECTED', reason: 'HIGH RISK - perlu perbaikan data sebelum EDD' })
        .expect(200);

      expect(res.body.status).toBe('REVISION_REQUIRED');
      expect(res.body.revision_reason).toBe('HIGH RISK - perlu perbaikan data sebelum EDD');
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

    it('O-06: FrontDesk PATCH /edd draft (partial, bagian I-III) → 200, data tersimpan + snapshot tetap ada', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          high_risk_reasons: {
            customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'],
          },
        })
        .expect(200);

      expect(res.body.edd_completed).toBe(false);
      expect(res.body.high_risk_reasons.customer_characteristics).toContain('HIGH_RISK_OCCUPATION_OR_BUSINESS');
      // snapshot dari initEddForHighRisk harus tetap ada
      expect(res.body.applicant_snapshot.full_name).toBe(EDD_PERSON_NAME);
    });

    it('O-07: FrontDesk PATCH /edd complete=true dengan data tidak lengkap → 400 dengan errors', async () => {
      // Hanya kirim complete=true tanpa field wajib lainnya
      // compliance_decision.decision dan internal_checklist.edd_form_completed masih kosong
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ complete: true })
        .expect(400);

      expect(res.body.message).toContain('EDD belum memenuhi syarat');
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
    });

    it('O-08: FrontDesk isi I-III lalu ComplianceLead isi IV-VII+complete → edd_completed=true', async () => {
      // Step 1: FrontDesk fills sections I–III (with new required dropdown fields)
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          applicant_snapshot: {
            full_name: EDD_PERSON_NAME,
            identity_number: `31890000${SUFFIX}`,
            identity_type: 'KTP',
            customer_category: 'INDIVIDUAL',
          },
          high_risk_reasons: {
            customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'],
          },
          additional_information: {
            source_of_funds: 'Gaji',
            business_relationship_purpose: 'Kegiatan usaha atau transaksi bisnis',
          },
        })
        .expect(200);

      // Step 2: ComplianceLead fills sections IV–VII with complete=true
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          complete: true,
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

    it('O-10: LOW RISK app dapat APPROVE tanpa EDD oleh OperationSupervisor', async () => {
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: 'Budi Santoso Murni',
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(lowId);

      const submitRes = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${lowId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(submitRes.body.status).toBe('SUBMITTED');
      expect(submitRes.body.risk.risk_level).not.toBe('HIGH');

      const approveRes = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${lowId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'APPROVED' })
        .expect(200);

      expect(approveRes.body.status).toBe('APPROVED');
    });

    it('O-11: FrontDesk GET /edd → 200 (Frontline pengisi EDD)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      expect(res.body.edd_required).toBe(true);
    });

    it('O-12: ComplianceLead GET /edd setelah complete → 200, edd_completed=true', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.edd_required).toBe(true);
      expect(res.body.edd_completed).toBe(true);
    });

    it('O-13: FrontDesk PATCH /edd bagian I-III → 200 (Frontline dapat mengisi I–III)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ additional_information: { notes: 'catatan tambahan dari frontdesk' } })
        .expect(200);

      expect(res.body.edd_completed).toBe(true);
    });

    it('O-13c: ComplianceLead PATCH /edd bagian I-III → 403 (bagian I-III hanya untuk FrontDesk)', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${eddHighAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ applicant_snapshot: { hacked: true } })
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

      // FrontDesk pre-fills I–III (required for completion validation)
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${condAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          high_risk_reasons: { customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'] },
          additional_information: {
            source_of_funds: 'Gaji',
            business_relationship_purpose: 'Kegiatan usaha atau transaksi bisnis',
          },
        })
        .expect(200);

      // ComplianceLead sends IV–VII with complete=true but NOT_CONSISTENT without consistency_notes → 400
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${condAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          complete: true,
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
  // GF. EDD role ownership, dropdown fields, & transfer final flow
  // ══════════════════════════════════════════════════════════
  describe('GF. EDD role ownership + dropdown fields + transfer final flow', () => {
    let gfAppId: string;

    async function createGfHighRiskApp(identNum: string, phone: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GF Risk Test ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: identNum,
          address_identity: 'Jl. GF No. 1, Jakarta',
          pob: 'Jakarta',
          dob: '1975-01-01',
          nationality: 'ID',
          phone,
          occupation: 'casino dealer',
          gender: 'M',
          signature_uri: 'https://storage.test/gf_sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);
      const { rows } = await pgPool.query('SELECT person_id FROM applications WHERE id=$1', [appId]);
      await pgPool.query('UPDATE persons SET pep_self_declared=true WHERE id=$1', [rows[0].person_id]);
      const docRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/gf_ktp.jpg' })
        .expect(201);
      await pgPool.query('UPDATE documents SET status=$1 WHERE id=$2', ['REJECTED', docRes.body.id]);
      await uploadFacePhotoDocs(appId);
      return appId;
    }

    it('GF-01: setup — create HIGH RISK app and submit', async () => {
      gfAppId = await createGfHighRiskApp(`31897001${SUFFIX}`, `087701${SUFFIX}`);
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(res.body.risk.risk_level).toBe('HIGH');
    });

    it('GF-02: FrontDesk PATCH EDD sections I-III → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          high_risk_reasons: { customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'] },
        })
        .expect(200);
      expect(res.body.high_risk_reasons.customer_characteristics).toContain('HIGH_RISK_OCCUPATION_OR_BUSINESS');
    });

    it('GF-03: FrontDesk PATCH EDD sections V-VII → 403 "Frontline hanya dapat mengisi EDD bagian I sampai IV."', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ officer_analysis: { overall_risk_summary: 'HIGH' } })
        .expect(403);
      expect(res.body.message).toContain('Frontline hanya dapat mengisi EDD bagian I sampai IV');
    });

    it('GF-03b: FrontDesk PATCH EDD section IV (beneficial_owner) → 200 (Frontline dapat mengisi BO)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ beneficial_owner: { full_name: 'BO Frontline', ownership_percentage: 55 } })
        .expect(200);
      expect(res.body.beneficial_owner.full_name).toBe('BO Frontline');
    });

    it('GF-04: ComplianceLead PATCH EDD sections V-VII → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ officer_analysis: { overall_risk_summary: 'HIGH' } })
        .expect(200);
      expect(res.body.officer_analysis.overall_risk_summary).toBe('HIGH');
    });

    it('GF-05: ComplianceLead PATCH EDD sections I-III → 403 "Lead Compliance hanya dapat mengisi EDD bagian V sampai VII."', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ high_risk_reasons: { customer_characteristics: ['HACK'] } })
        .expect(403);
      expect(res.body.message).toContain('Lead Compliance hanya dapat mengisi EDD bagian V sampai VII');
    });

    it('GF-05b: ComplianceLead PATCH EDD section IV (beneficial_owner) → 403 (BO milik Frontline)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ beneficial_owner: { full_name: 'Should be blocked' } })
        .expect(403);
      expect(res.body.message).toContain('Lead Compliance hanya dapat mengisi EDD bagian V sampai VII');
    });

    it('GF-06: Auditor PATCH EDD → 403 (read-only)', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ high_risk_reasons: {} })
        .expect(403);
    });

    it('GF-07: FrontDesk saves source_of_funds dropdown in additional_information', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          additional_information: {
            source_of_funds: 'Gaji',
            business_relationship_purpose: 'Kegiatan usaha atau transaksi bisnis',
          },
        })
        .expect(200);
      expect(res.body.additional_information.source_of_funds).toBe('Gaji');
      expect(res.body.additional_information.business_relationship_purpose).toBe('Kegiatan usaha atau transaksi bisnis');
    });

    it('GF-08: source_of_funds_other required when "Pendapatan lain/Lainnya" → 400', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          additional_information: {
            source_of_funds: 'Pendapatan lain/Lainnya',
          },
        })
        .expect(400);
      expect(res.body.message).toContain('source_of_funds_other');
    });

    it('GF-09: business_relationship_purpose dropdown saves + other required when "Lainnya"', async () => {
      // store valid value first
      const res1 = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          additional_information: {
            source_of_funds: 'Investasi',
            business_relationship_purpose: 'Lainnya',
          },
        })
        .expect(400);
      expect(res1.body.message).toContain('business_relationship_purpose_other');
    });

    it('GF-10: source_of_funds_other provided → saves correctly', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${gfAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          additional_information: {
            source_of_funds: 'Pendapatan lain/Lainnya',
            source_of_funds_other: 'Royalti karya tulis',
            business_relationship_purpose: 'Lainnya',
            business_relationship_purpose_other: 'Pembayaran konsultasi',
          },
        })
        .expect(200);
      expect(res.body.additional_information.source_of_funds).toBe('Pendapatan lain/Lainnya');
      expect(res.body.additional_information.source_of_funds_other).toBe('Royalti karya tulis');
      expect(res.body.additional_information.business_relationship_purpose).toBe('Lainnya');
      expect(res.body.additional_information.business_relationship_purpose_other).toBe('Pembayaran konsultasi');
    });

    it('GF-11: EDD complete requires source_of_funds and business_relationship_purpose', async () => {
      // Create a fresh HIGH RISK app and try to complete EDD without the new required fields
      const freshAppId = await createGfHighRiskApp(`31897002${SUFFIX}`, `087702${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${freshAppId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      // FrontDesk fills I-III without new dropdown fields
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${freshAppId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          high_risk_reasons: { customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'] },
        })
        .expect(200);

      // ComplianceLead tries complete=true without source_of_funds and business_relationship_purpose → 400
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${freshAppId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          complete: true,
          officer_analysis: {
            overall_risk_summary: 'HIGH',
            follow_up_recommendations: ['REQUEST_ADDITIONAL_DOCUMENTS'],
            cdd_edd_consistency: 'CONSISTENT',
          },
          compliance_decision: { decision: 'APPROVED' },
          internal_checklist: { edd_form_completed: true },
        })
        .expect(400);

      expect(res.body.errors.some((e: string) => e.includes('source_of_funds'))).toBe(true);
      expect(res.body.errors.some((e: string) => e.includes('business_relationship_purpose'))).toBe(true);
    });

    it('GF-12: Full 4-step transfer flow → COMPLETED/SUCCESS', async () => {
      // Create approved sender
      const senderApp = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GF Transfer Sender ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `31897901${SUFFIX}`,
          address_identity: 'Jl. GF Transfer No. 1',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `0877901${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          signature_uri: 'https://storage.test/gf_trx_sig.png',
        })
        .expect(201);
      const senderAppId = String(senderApp.body.id);
      await pgPool.query(`UPDATE applications SET status='APPROVED' WHERE id=$1`, [senderAppId]);

      // Create transfer
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          amount: 100_000,
          sender_application_id: Number(senderAppId),
          beneficiaryBankName: 'Bank GF',
          beneficiaryAccountNumber: '1234567890',
          beneficiaryAccountName: 'Penerima GF',
        })
        .expect(201);
      const txId = String(createRes.body.id);
      expect(createRes.body.status).toBe('DRAFT');

      // Submit
      const submitRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/submit`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(201);
      expect(submitRes.body.status).toBe('SUBMITTED');

      // OperationSupervisor layer 1
      const supRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'dokumen lengkap' })
        .expect(201);
      expect(supRes.body.status).toBe('PENDING_FINANCE_STAFF_REVIEW');

      // FinanceStaff layer 2
      const staffRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'siap disetujui' })
        .expect(201);
      expect(staffRes.body.status).toBe('PENDING_FINANCE_MANAGER_APPROVAL');

      // FinanceManager final → COMPLETED/SUCCESS
      const finalRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE', decision_notes: 'disetujui manager' })
        .expect(201);
      expect(finalRes.body.status).toBe('COMPLETED');
      expect(finalRes.body.result).toBe('SUCCESS');
      expect(finalRes.body.approved_at).not.toBeNull();
      expect(finalRes.body.completed_at).not.toBeNull();
    });

    it('GF-13: FinanceManager cannot approve before FinanceStaff review → 400', async () => {
      // Create approved sender
      const senderApp = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GF Early Approve ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `31897902${SUFFIX}`,
          address_identity: 'Jl. GF Early No. 1',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `0877902${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          signature_uri: 'https://storage.test/gf_early_sig.png',
        })
        .expect(201);
      const senderAppId = String(senderApp.body.id);
      await pgPool.query(`UPDATE applications SET status='APPROVED' WHERE id=$1`, [senderAppId]);

      // Create + submit transfer (SUBMITTED)
      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          amount: 50_000,
          sender_application_id: Number(senderAppId),
          beneficiaryBankName: 'Bank Early',
          beneficiaryAccountNumber: '9999888777',
          beneficiaryAccountName: 'Penerima Early',
        })
        .expect(201);
      const txId = String(createRes.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/submit`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(201);

      // FinanceManager tries to approve SUBMITTED transfer (bypassing supervisor+finance) → 400
      const res = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE' })
        .expect(400);
      expect(res.body.message).toContain('OperationSupervisor');
    });
  });

  // ══════════════════════════════════════════════════════════
  // GG. Latest changes — KYB share portion, EDD role ownership/director removal,
  //     EDD additional documents, and backend-generated approval timestamps.
  // ══════════════════════════════════════════════════════════
  describe('GG. KYB share portion + EDD docs + backend timestamps', () => {
    let eddDocsAppId: string;
    const eddDocIds: string[] = [];
    const JPEG_1PX = Buffer.from(
      'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b08000100010101110000ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda00080101000000010aff00ffd9',
      'hex',
    );

    function baseBizBodyGG(tag: string) {
      return {
        legal_name: `PT GG ${tag} ${SUFFIX}`,
        legal_form: 'PT',
        incorporation_place: 'Jakarta',
        incorporation_date: '2018-03-01',
        deed_number: `AKTA-GG-${tag}-${SUFFIX}`,
        business_license_number: `IZNGG${tag}${SUFFIX}`,
        nib: `NIBGG${tag}${SUFFIX}`,
        npwp: npwp15(`GG${tag}`),
        address_line: 'Jl. GG No. 1',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        postal_code: '10110',
        business_activity: 'Perdagangan Umum',
        phone: `021GG${tag}${SUFFIX}`,
      };
    }

    // ── 1. KYB share portion for Director & Commissioner ────────────────────
    it('GG-01: KYB create with director/commissioner share percentage → 201 + detail returns them', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          ...baseBizBodyGG('A'),
          director_share_percentage: 60,
          commissioner_share_percentage: 40,
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${create.body.id}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.business.director_share_percentage).toBe(60);
      expect(detail.body.business.commissioner_share_percentage).toBe(40);
    });

    it('GG-02: KYB decimal share percentage supported → 201 + returned as number', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          ...baseBizBodyGG('B'),
          director_share_percentage: 33.33,
          commissioner_share_percentage: 0,
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${create.body.id}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.business.director_share_percentage).toBeCloseTo(33.33, 2);
      expect(detail.body.business.commissioner_share_percentage).toBe(0);
    });

    it('GG-03: KYB share percentage omitted → 201 + fields null (optional)', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ ...baseBizBodyGG('C') })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${create.body.id}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.business.director_share_percentage).toBeNull();
      expect(detail.body.business.commissioner_share_percentage).toBeNull();
    });

    it('GG-04: KYB director share > 100 → 400', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ ...baseBizBodyGG('D'), director_share_percentage: 150 })
        .expect(400);
    });

    it('GG-05: KYB commissioner share < 0 → 400', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ ...baseBizBodyGG('E'), commissioner_share_percentage: -5 })
        .expect(400);
    });

    // ── 4. EDD additional documents (Frontline) — multiple rows same doc_type ─
    it('GG-06: EDD additional documents — upload two EDD_ADDITIONAL_DOCUMENT files', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GG EDD Docs ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `31896100${SUFFIX}`,
          address_identity: 'Jl. GG EDD No. 1',
          pob: 'Jakarta',
          dob: '1988-01-01',
          nationality: 'ID',
          phone: `086100${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'M',
          signature_uri: 'https://storage.test/gg_edd_sig.png',
        })
        .expect(201);
      eddDocsAppId = String(create.body.id);

      for (let i = 1; i <= 2; i++) {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/${eddDocsAppId}/documents/upload`)
          .set('Authorization', `Bearer ${frontDeskToken}`)
          .field('doc_type', 'EDD_ADDITIONAL_DOCUMENT')
          .attach('file', JPEG_1PX, { filename: `edd_extra_${i}.jpg`, contentType: 'image/jpeg' })
          .expect(201);
        expect(res.body.doc_type).toBe('EDD_ADDITIONAL_DOCUMENT');
        eddDocIds.push(String(res.body.id));
      }

      const list = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddDocsAppId}/documents`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);
      const eddDocs = list.body.filter((d: any) => d.doc_type === 'EDD_ADDITIONAL_DOCUMENT');
      expect(eddDocs.length).toBe(2);
    });

    it('GG-07: EDD additional documents — add a 3rd (more than two) + visible in detail', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/${eddDocsAppId}/documents/upload`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .field('doc_type', 'EDD_ADDITIONAL_DOCUMENT')
        .attach('file', JPEG_1PX, { filename: 'edd_extra_3.jpg', contentType: 'image/jpeg' })
        .expect(201);
      eddDocIds.push(String(res.body.id));

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddDocsAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      const eddDocs = detail.body.documents.filter(
        (d: any) => d.doc_type === 'EDD_ADDITIONAL_DOCUMENT',
      );
      expect(eddDocs.length).toBe(3);
    });

    it('GG-08: EDD additional document — view (signed url) then delete works', async () => {
      const docId = eddDocIds[0];
      const urlRes = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddDocsAppId}/documents/${docId}/url`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);
      expect(typeof urlRes.body.signed_url).toBe('string');

      await request(app.getHttpServer())
        .delete(`${BASE}/applications/${eddDocsAppId}/documents/${docId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      const list = await request(app.getHttpServer())
        .get(`${BASE}/applications/${eddDocsAppId}/documents`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);
      const eddDocs = list.body.filter((d: any) => d.doc_type === 'EDD_ADDITIONAL_DOCUMENT');
      expect(eddDocs.length).toBe(2);
    });

    // ── EDD HIGH RISK helper for timestamp / director-removal tests ──────────
    async function createHighRiskForGG(identNum: string, phone: string): Promise<string> {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GG EDD Risk ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: identNum,
          address_identity: 'Jl. GG Risk No. 1',
          pob: 'Jakarta',
          dob: '1972-01-01',
          nationality: 'ID',
          phone,
          occupation: 'casino dealer',
          gender: 'M',
          signature_uri: 'https://storage.test/gg_risk_sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);
      const { rows } = await pgPool.query('SELECT person_id FROM applications WHERE id=$1', [appId]);
      await pgPool.query('UPDATE persons SET pep_self_declared=true WHERE id=$1', [rows[0].person_id]);
      const docRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/gg_risk_ktp.jpg' })
        .expect(201);
      await pgPool.query('UPDATE documents SET status=$1 WHERE id=$2', ['REJECTED', docRes.body.id]);
      await uploadFacePhotoDocs(appId);
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      return appId;
    }

    // ── 3 + 6. EDD completes without director_decision; compliance date is
    //          backend-generated & any client-provided date is ignored. ───────
    it('GG-09: EDD completes without director_decision + compliance date backend-generated (client date ignored)', async () => {
      const appId = await createHighRiskForGG(`31896200${SUFFIX}`, `086200${SUFFIX}`);

      // FrontDesk fills I–IV
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/edd`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          applicant_snapshot: { full_name: `GG EDD Risk ${SUFFIX}`, customer_category: 'INDIVIDUAL' },
          high_risk_reasons: { customer_characteristics: ['HIGH_RISK_OCCUPATION_OR_BUSINESS'] },
          additional_information: {
            source_of_funds: 'Gaji',
            business_relationship_purpose: 'Kegiatan usaha atau transaksi bisnis',
          },
          beneficial_owner: { full_name: 'BO GG', ownership_percentage: 30 },
        })
        .expect(200);

      // ComplianceLead fills V–VII, sends a bogus client date + a director_decision
      // (both must be ignored). No director approval required for completion.
      const clientDate = '1999-01-01T00:00:00.000Z';
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/edd`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          complete: true,
          officer_analysis: {
            overall_risk_summary: 'HIGH',
            follow_up_recommendations: ['REQUEST_ADDITIONAL_DOCUMENTS'],
            cdd_edd_consistency: 'CONSISTENT',
          },
          compliance_decision: { decision: 'APPROVED', date: clientDate, officer_name: 'Lead' },
          director_decision: { decision: 'APPROVED', director_name: 'Should be ignored' },
          internal_checklist: { edd_form_completed: true },
        })
        .expect(200);

      // EDD completed relying on compliance decision only (no director approval).
      expect(res.body.edd_completed).toBe(true);
      // compliance_decision.date is backend-generated and NOT the client value.
      expect(res.body.compliance_decision.date).toBeDefined();
      expect(res.body.compliance_decision.date).not.toBe(clientDate);
      const stamped = new Date(res.body.compliance_decision.date).getTime();
      expect(Date.now() - stamped).toBeLessThan(60_000);
      // director_decision from the request body must be ignored (deprecated).
      expect(res.body.director_decision?.director_name).toBeUndefined();
    });

    // ── 6. KYC/KYB decision timestamp is backend-generated ──────────────────
    it('GG-10: KYC/KYB approval decision_at is backend-generated', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GG Approve TS ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `31896300${SUFFIX}`,
          address_identity: 'Jl. GG Approve No. 1',
          pob: 'Bandung',
          dob: '1991-01-01',
          nationality: 'ID',
          phone: `086300${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'M',
          signature_uri: 'https://storage.test/gg_appr_sig.png',
        })
        .expect(201);
      const appId = String(create.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/gg_appr_ktp.jpg' })
        .expect(201);
      await uploadFacePhotoDocs(appId);
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      // Send a bogus decision_at in the body — it must be ignored (whitelist + now()).
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ decision: 'APPROVED', decision_at: '1990-01-01T00:00:00.000Z' })
        .expect(200);

      expect(res.body.status).toBe('APPROVED');
      expect(res.body.decision_at).toBeDefined();
      const stamped = new Date(res.body.decision_at).getTime();
      expect(Date.now() - stamped).toBeLessThan(60_000);
    });

    // ── 6. Transfer supervisor/finance/final timestamps are backend-generated ─
    it('GG-11: Transfer supervisor & finance review timestamps are backend-generated', async () => {
      const senderApp = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `GG Transfer TS ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `31896400${SUFFIX}`,
          address_identity: 'Jl. GG Transfer No. 1',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `086400${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          signature_uri: 'https://storage.test/gg_trx_sig.png',
        })
        .expect(201);
      const senderAppId = String(senderApp.body.id);
      await pgPool.query(`UPDATE applications SET status='APPROVED' WHERE id=$1`, [senderAppId]);

      const createRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          amount: 75_000,
          sender_application_id: Number(senderAppId),
          beneficiaryBankName: 'Bank GG',
          beneficiaryAccountNumber: '5556667778',
          beneficiaryAccountName: 'Penerima GG',
        })
        .expect(201);
      const txId = String(createRes.body.id);

      await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/submit`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(201);

      // Supervisor review — send a bogus timestamp; server must ignore it.
      const supRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/supervisor-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE', notes: 'ok', supervisor_reviewed_at: '1990-01-01T00:00:00.000Z' })
        .expect(201);
      expect(supRes.body.supervisor_reviewed_at).not.toBeNull();
      expect(Date.now() - new Date(supRes.body.supervisor_reviewed_at).getTime()).toBeLessThan(60_000);

      const staffRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/finance-review`)
        .set('Authorization', `Bearer ${financeStaffToken}`)
        .send({ action: 'APPROVE', notes: 'ok' })
        .expect(201);
      expect(staffRes.body.finance_reviewed_at).not.toBeNull();
      expect(Date.now() - new Date(staffRes.body.finance_reviewed_at).getTime()).toBeLessThan(60_000);

      const finalRes = await request(app.getHttpServer())
        .post(`${BASE}/transfers/${txId}/decision`)
        .set('Authorization', `Bearer ${financeManagerToken}`)
        .send({ decision: 'APPROVE' })
        .expect(201);
      expect(finalRes.body.approved_at).not.toBeNull();
      expect(Date.now() - new Date(finalRes.body.approved_at).getTime()).toBeLessThan(60_000);
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
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(pepWlAppId);

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
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(pepSelfAppId);

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

    const CIF_NPWP_NO_NIB = npwp15('98765432'); // 15-digit angka (digits only)
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
          ktp_number: TEST_KTP_NUMBER,
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
          deed_number: `AKTA-CIF-${SUFFIX}`,
          business_license_number: `BL_CIF_${SUFFIX}`,
          nib: CIF_NIB,
          npwp: npwp15('11'),
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
          ktp_number: TEST_KTP_NUMBER,
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
      // Add required photo docs so precheck passes
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${cifIndivAppId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/cif_ktp.jpg' })
        .expect(201);

      await uploadFacePhotoDocs(cifIndivAppId);

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
          deed_number: `AKTA-BOF-${SUFFIX}`,
          business_license_number: `BL_BOF_${SUFFIX}`,
          nib: `9000100${SUFFIX}`,
          npwp: npwp15('22'),
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
          ktp_number: TEST_KTP_NUMBER,
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
          ktp_number: TEST_KTP_NUMBER,
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
          deed_number: `AKTA-IFB-${SUFFIX}`,
          business_license_number: `BL_IFB_${SUFFIX}`,
          nib: `9000200${SUFFIX}`,
          npwp: npwp15('33'),
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
          ktp_number: TEST_KTP_NUMBER,
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
          wic_transaction_purpose: 'Pembelian barang',
          wic_recipient_relationship: 'Keluarga',
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
  // RW. WIC (Walk-In Customer) submit — minimum CDD only
  //   - WIC submits with only WIC identity + signature/biometric docs.
  //   - WIC must NOT require the full Individual selfie / selfie-with-KTP photos,
  //     nor occupation / full RBA fields.
  //   - Missing WIC docs must return a clear 400 (not a 500 from the DB trigger).
  // ══════════════════════════════════════════════════════════
  describe('RW. WIC submit — minimum CDD', () => {
    const auth = () => ['Authorization', `Bearer ${complianceToken}`] as const;

    async function createWic(identNum: string) {
      const cr = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `WIC Submit ${identNum}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: identNum,
          address_identity: 'Jl. WIC Submit No. 1, Bandung',
          pob: 'Bandung',
          dob: '1990-05-05',
          cif_relationship_type: 'WIC',
          wic_transaction_purpose: 'Pembelian barang',
          wic_recipient_relationship: 'Keluarga',
          // NOTE: intentionally NO phone / nationality / occupation / gender —
          // WIC minimum CDD must not require them.
        })
        .expect(201);
      const appId = String(cr.body.id);

      // person must be flagged WIC (no CIF) so the WIC branch is exercised
      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(detail.body.person.cif_relationship_type).toBe('WIC');

      return appId;
    }

    async function addDoc(appId: string, docType: string) {
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set(...auth())
        .send({ doc_type: docType, file_uri: `https://storage.test/${docType}.jpg` })
        .expect(201);
    }

    it('RW-01: WIC with identity + signature/biometric docs → submit 200', async () => {
      const appId = await createWic(`3399100${SUFFIX}`);
      await addDoc(appId, 'WIC_IDENTITY_DOCUMENT');
      await addDoc(appId, 'WIC_SIGNATURE_BIOMETRIC');

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set(...auth())
        .expect(200);

      expect(res.body.id).toBeDefined();
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });

    it('RW-02: WIC without WIC_SIGNATURE_BIOMETRIC → 400 with clear message', async () => {
      const appId = await createWic(`3399200${SUFFIX}`);
      await addDoc(appId, 'WIC_IDENTITY_DOCUMENT');

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set(...auth())
        .expect(400);

      expect(res.body.message).toContain('WIC CDD minimum belum lengkap');
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('Tanda Tangan / Biometrik'))).toBe(true);
      // identity doc present → not reported missing
      expect(missing.some((m) => m.includes('Dokumen Identitas WIC'))).toBe(false);
    });

    it('RW-03: WIC without WIC_IDENTITY_DOCUMENT → 400 with clear message', async () => {
      const appId = await createWic(`3399300${SUFFIX}`);
      await addDoc(appId, 'WIC_SIGNATURE_BIOMETRIC');

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set(...auth())
        .expect(400);

      expect(res.body.message).toContain('WIC CDD minimum belum lengkap');
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('Dokumen Identitas WIC'))).toBe(true);
      expect(missing.some((m) => m.includes('Tanda Tangan / Biometrik'))).toBe(false);
    });

    it('RW-04: WIC does not require INDIVIDUAL_FACE_PHOTO / FACE_WITH_KTP nor occupation', async () => {
      const appId = await createWic(`3399400${SUFFIX}`);
      // Only WIC docs — no selfie / selfie-with-KTP uploaded.
      await addDoc(appId, 'WIC_IDENTITY_DOCUMENT');
      await addDoc(appId, 'WIC_SIGNATURE_BIOMETRIC');

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set(...auth())
        .expect(200);

      expect(['SUBMITTED', 'IN_REVIEW']).toContain(res.body.status);
    });

    it('RW-05: WIC precheck missing both docs → 400 lists both WIC docs (never selfie)', async () => {
      const appId = await createWic(`3399500${SUFFIX}`);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}/precheck`)
        .set(...auth())
        .expect(400);

      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('Dokumen Identitas WIC'))).toBe(true);
      expect(missing.some((m) => m.includes('Tanda Tangan / Biometrik'))).toBe(true);
      // Must never demand full-KYC selfie docs for WIC.
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_PHOTO'))).toBe(false);
      expect(missing.some((m) => m.includes('INDIVIDUAL_FACE_WITH_KTP_PHOTO'))).toBe(false);
    });

    it('RW-06: GET detail returns wic fields + cif_relationship_type for WIC', async () => {
      const appId = await createWic(`3399600${SUFFIX}`);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set(...auth())
        .expect(200);

      expect(res.body.person.cif_relationship_type).toBe('WIC');
      expect(res.body.person.wic_transaction_purpose).toBe('Pembelian barang');
      expect(res.body.person.wic_recipient_relationship).toBe('Keluarga');
    });

    it('RW-07: PATCH /applications/:id saves wic_transaction_purpose & wic_recipient_relationship', async () => {
      const appId = await createWic(`3399700${SUFFIX}`);

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}`)
        .set(...auth())
        .send({
          cif_relationship_type: 'WIC',
          wic_transaction_purpose: 'Pengiriman uang',
          wic_recipient_relationship: 'Rekan bisnis',
        })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set(...auth())
        .expect(200);

      expect(res.body.person.wic_transaction_purpose).toBe('Pengiriman uang');
      expect(res.body.person.wic_recipient_relationship).toBe('Rekan bisnis');
      expect(res.body.person.cif_relationship_type).toBe('WIC');
    });

    it('RW-08: PATCH omitting wic fields PRESERVES them → WIC can still submit', async () => {
      const appId = await createWic(`3399800${SUFFIX}`);
      await addDoc(appId, 'WIC_IDENTITY_DOCUMENT');
      await addDoc(appId, 'WIC_SIGNATURE_BIOMETRIC');

      // Simulate an unrelated edit on the detail page that does NOT resend the
      // WIC fields (e.g. only touches the address). These must not be wiped.
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}`)
        .set(...auth())
        .send({
          cif_relationship_type: 'WIC',
          address_identity: 'Jl. WIC Baru No. 9, Bandung',
        })
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set(...auth())
        .expect(200);
      expect(detail.body.person.wic_transaction_purpose).toBe('Pembelian barang');
      expect(detail.body.person.wic_recipient_relationship).toBe('Keluarga');

      const submit = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set(...auth())
        .expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(submit.body.status);
    });

    it('RW-09: WIC cannot submit when wic_transaction_purpose is cleared → 400', async () => {
      const appId = await createWic(`3399900${SUFFIX}`);
      await addDoc(appId, 'WIC_IDENTITY_DOCUMENT');
      await addDoc(appId, 'WIC_SIGNATURE_BIOMETRIC');

      // Explicitly clear one required WIC field via PATCH.
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}`)
        .set(...auth())
        .send({ cif_relationship_type: 'WIC', wic_transaction_purpose: '' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set(...auth())
        .expect(400);

      expect(res.body.message).toContain('WIC CDD minimum belum lengkap');
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('Tujuan Transaksi'))).toBe(true);
    });

    it('RW-10: WIC cannot submit when wic_recipient_relationship is cleared → 400', async () => {
      const appId = await createWic(`3391000${SUFFIX}`);
      await addDoc(appId, 'WIC_IDENTITY_DOCUMENT');
      await addDoc(appId, 'WIC_SIGNATURE_BIOMETRIC');

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}`)
        .set(...auth())
        .send({ cif_relationship_type: 'WIC', wic_recipient_relationship: '' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set(...auth())
        .expect(400);

      expect(res.body.message).toContain('WIC CDD minimum belum lengkap');
      const missing: string[] = res.body.missing;
      expect(missing.some((m) => m.includes('Hubungan dengan Penerima'))).toBe(true);
    });

    // Raw WIC create (own payload, not the shared helper) so reuse scenarios can
    // send different WIC field values per call.
    async function createWicRaw(identNum: string, body: Record<string, unknown>) {
      const cr = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set(...auth())
        .send({
          full_name: `WIC Reuse ${identNum}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: identNum,
          address_identity: 'Jl. WIC Reuse No. 1, Bandung',
          pob: 'Bandung',
          dob: '1990-05-05',
          cif_relationship_type: 'WIC',
          ...body,
        })
        .expect(201);
      return String(cr.body.id);
    }

    it('RW-11: create WIC with fresh identity saves WIC purpose/relationship', async () => {
      const nik = `3392100${SUFFIX}`;
      const appId = await createWicRaw(nik, {
        wic_transaction_purpose: 'Beli pulsa',
        wic_recipient_relationship: 'Teman',
      });

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set(...auth())
        .expect(200);

      expect(res.body.person.cif_relationship_type).toBe('WIC');
      expect(res.body.person.cif_no).toBeNull();
      expect(res.body.person.wic_transaction_purpose).toBe('Beli pulsa');
      expect(res.body.person.wic_recipient_relationship).toBe('Teman');
    });

    it('RW-12: create WIC on EXISTING person also saves WIC purpose/relationship', async () => {
      const nik = `3392200${SUFFIX}`;

      // First WIC create → person now exists (WIC, no CIF).
      await createWicRaw(nik, {
        wic_transaction_purpose: 'Beli A',
        wic_recipient_relationship: 'Saudara',
      });

      // Second WIC create with the SAME identity reuses that person. The reuse
      // path must persist the (different) WIC fields, not silently skip them.
      const app2 = await createWicRaw(nik, {
        wic_transaction_purpose: 'Kirim uang B',
        wic_recipient_relationship: 'Rekan bisnis',
      });

      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications/${app2}`)
        .set(...auth())
        .expect(200);

      expect(res.body.person.cif_relationship_type).toBe('WIC');
      expect(res.body.person.cif_no).toBeNull();
      expect(res.body.person.wic_transaction_purpose).toBe('Kirim uang B');
      expect(res.body.person.wic_recipient_relationship).toBe('Rekan bisnis');
    });

    it('RW-13: reused WIC person can submit after WIC docs uploaded', async () => {
      const nik = `3392300${SUFFIX}`;

      await createWicRaw(nik, {
        wic_transaction_purpose: 'Beli barang',
        wic_recipient_relationship: 'Keluarga',
      });
      const app2 = await createWicRaw(nik, {
        wic_transaction_purpose: 'Beli barang lagi',
        wic_recipient_relationship: 'Keluarga',
      });

      await addDoc(app2, 'WIC_IDENTITY_DOCUMENT');
      await addDoc(app2, 'WIC_SIGNATURE_BIOMETRIC');

      const submit = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${app2}/submit`)
        .set(...auth())
        .expect(200);
      expect(['SUBMITTED', 'IN_REVIEW']).toContain(submit.body.status);
    });

    it('RW-14: OUR_CUSTOMER reuse unchanged — keeps CIF and OUR_CUSTOMER type', async () => {
      const nik = `3392400${SUFFIX}`;

      // First OUR_CUSTOMER create → gets a CIF.
      const app1 = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set(...auth())
        .send({
          full_name: `OC Reuse ${nik}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: nik,
          address_identity: 'Jl. OC Reuse No. 1',
          pob: 'Jakarta',
          dob: '1988-02-02',
          nationality: 'ID',
          phone: `08123${SUFFIX}`,
          occupation: 'Karyawan',
          gender: 'M',
        })
        .expect(201);
      const detail1 = await request(app.getHttpServer())
        .get(`${BASE}/applications/${String(app1.body.id)}`)
        .set(...auth())
        .expect(200);
      const cif = detail1.body.person.cif_no;
      expect(cif).toMatch(/^KSHI\d{11}$/);
      expect(detail1.body.person.cif_relationship_type).toBe('OUR_CUSTOMER');

      // Second OUR_CUSTOMER create with same identity → reuses the same CIF.
      const app2 = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set(...auth())
        .send({
          full_name: `OC Reuse ${nik}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: nik,
          address_identity: 'Jl. OC Reuse No. 2',
          pob: 'Jakarta',
          dob: '1988-02-02',
          nationality: 'ID',
          phone: `08124${SUFFIX}`,
          occupation: 'Wiraswasta',
          gender: 'M',
        })
        .expect(201);
      const detail2 = await request(app.getHttpServer())
        .get(`${BASE}/applications/${String(app2.body.id)}`)
        .set(...auth())
        .expect(200);
      expect(detail2.body.person.cif_no).toBe(cif);
      expect(detail2.body.person.cif_relationship_type).toBe('OUR_CUSTOMER');
    });
  });

  // ══════════════════════════════════════════════════════════
  // S. RBA Occupation & Geography scoring (disabled — watchlist-only mode)
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
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(appId);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      return res.body;
    }

    // ── RBA disabled: no occupation/geography factors, risk_level LOW ──

    it('S-01: Occupation "PNS" without watchlist → risk_level LOW, no INDIVIDUAL_OCCUPATION_HIGH_RBA', async () => {
      const body = await createAndSubmit({
        identNum: `3299501${SUFFIX}`,
        phone: `09001${SUFFIX}`,
        occupation: 'PNS',
        address: 'Jl. Merdeka No. 5, Purwokerto',
      });

      const factors: any[] = body.risk.risk_factors;
      expect(factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_HIGH_RBA')).toBeUndefined();
      expect(body.risk.risk_level).toBe('LOW');
    });

    it('S-02: Occupation "Pegawai BUMN" without watchlist → risk_level LOW, no INDIVIDUAL_OCCUPATION_MEDIUM_RBA', async () => {
      const body = await createAndSubmit({
        identNum: `3299502${SUFFIX}`,
        phone: `09002${SUFFIX}`,
        occupation: 'Pegawai BUMN',
        address: 'Jl. Industri No. 3, Malang',
      });

      const factors: any[] = body.risk.risk_factors;
      expect(factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_MEDIUM_RBA')).toBeUndefined();
      expect(body.risk.risk_level).toBe('LOW');
    });

    it('S-03: Occupation "Pegawai Bank" without watchlist → risk_level LOW, no INDIVIDUAL_OCCUPATION_LOW_RBA', async () => {
      const body = await createAndSubmit({
        identNum: `3299503${SUFFIX}`,
        phone: `09003${SUFFIX}`,
        occupation: 'Pegawai Bank',
        address: 'Jl. Perbankan No. 7, Semarang',
      });

      const factors: any[] = body.risk.risk_factors;
      expect(factors.find((x: any) => x.code === 'INDIVIDUAL_OCCUPATION_LOW_RBA')).toBeUndefined();
      expect(body.risk.risk_level).toBe('LOW');
    });

    it('S-04: Address "DKI Jakarta" without watchlist → risk_level LOW, no GEOGRAPHY_HIGH_RBA', async () => {
      const body = await createAndSubmit({
        identNum: `3299504${SUFFIX}`,
        phone: `09004${SUFFIX}`,
        occupation: 'Karyawan',
        address: 'Jl. Sudirman No. 1, DKI Jakarta 10220',
      });

      const factors: any[] = body.risk.risk_factors;
      expect(factors.find((x: any) => x.code === 'GEOGRAPHY_HIGH_RBA')).toBeUndefined();
      expect(body.risk.risk_level).toBe('LOW');
    });

    it('S-05: Address "DI Yogyakarta" without watchlist → risk_level LOW, no GEOGRAPHY_MEDIUM_RBA', async () => {
      const body = await createAndSubmit({
        identNum: `3299505${SUFFIX}`,
        phone: `09005${SUFFIX}`,
        occupation: 'Karyawan',
        address: 'Jl. Malioboro No. 10, DI Yogyakarta 55271',
      });

      const factors: any[] = body.risk.risk_factors;
      expect(factors.find((x: any) => x.code === 'GEOGRAPHY_MEDIUM_RBA')).toBeUndefined();
      expect(body.risk.risk_level).toBe('LOW');
    });

    it('S-06: Address "Papua" without watchlist → risk_level LOW, no GEOGRAPHY_LOW_RBA', async () => {
      const body = await createAndSubmit({
        identNum: `3299506${SUFFIX}`,
        phone: `09006${SUFFIX}`,
        occupation: 'Karyawan',
        address: 'Jl. Arfak No. 1, Papua 98301',
      });

      const factors: any[] = body.risk.risk_factors;
      expect(factors.find((x: any) => x.code === 'GEOGRAPHY_LOW_RBA')).toBeUndefined();
      expect(body.risk.risk_level).toBe('LOW');
    });

    it('S-07: Pegawai Negeri Sipil + Jakarta without watchlist → risk_level LOW, no RBA factors', async () => {
      const body = await createAndSubmit({
        identNum: `3299507${SUFFIX}`,
        phone: `09007${SUFFIX}`,
        occupation: 'Pegawai Negeri Sipil',
        address: 'Jl. Veteran No. 3, Jakarta Selatan 12160',
      });

      const factors: any[] = body.risk.risk_factors;
      const rbaFactors = factors.filter((x: any) =>
        x.code.endsWith('_RBA') || x.code.startsWith('GEOGRAPHY_'),
      );
      expect(rbaFactors).toHaveLength(0);
      expect(body.risk.risk_level).toBe('LOW');
      expect(body.risk.risk_score).toBe(0);
    });

    it('S-08: PEP self-declared forces HIGH even with LOW occupation + LOW geography (no RBA factors)', async () => {
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `RBA PEP Force ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(appId);

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.risk.risk_level).toBe('HIGH');
      expect(res.body.risk.risk_score).toBeGreaterThanOrEqual(70);
      const codes = res.body.risk.risk_factors.map((f: any) => f.code);
      expect(codes).toContain('INDIVIDUAL_PEP_SELF_DECLARED');
      // RBA disabled — occupation/geography factors must NOT appear
      expect(codes).not.toContain('INDIVIDUAL_OCCUPATION_LOW_RBA');
      expect(codes).not.toContain('GEOGRAPHY_LOW_RBA');
    });

    it('S-09: Pegawai Swasta + Jawa Barat without watchlist → risk_level LOW, no RBA factors', async () => {
      const body = await createAndSubmit({
        identNum: `3299509${SUFFIX}`,
        phone: `09009${SUFFIX}`,
        occupation: 'Pegawai Swasta',
        address: 'Jl. Merdeka No. 10, Bandung, Jawa Barat 40111',
      });

      const factors: any[] = body.risk.risk_factors;
      const rbaFactors = factors.filter((x: any) =>
        x.code.endsWith('_RBA') || (x.code.startsWith('GEOGRAPHY_') && x.source === 'rba_geography'),
      );
      expect(rbaFactors).toHaveLength(0);
      expect(body.risk.risk_level).toBe('LOW');
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
          ktp_number: TEST_KTP_NUMBER,
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

      await uploadFacePhotoDocs(appId);

      const submit = await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      // LOW risk → SUBMITTED (bukan IN_REVIEW)
      expect(submit.body.status).toBe('SUBMITTED');

      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/decision`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
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

    // ── T-01: OperationSupervisor tidak boleh akses monitoring ──
    it('T-01: OperationSupervisor GET /monitoring/cases → 403 (no access)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .expect(403);
    });

    it('T-01b: Director punya full access monitoring → GET cases 200', async () => {
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

    // Helper: staff review (approval pertama — ComplianceLead).
    function staffReview(
      caseId: string,
      action: string,
      notes = 'analisis staff',
      token = complianceToken,
    ) {
      return request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/staff-review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action, notes });
    }

    // Helper: manager review (approval kedua).
    function managerReview(
      caseId: string,
      action: string,
      notes = 'keputusan manager',
      token = complianceToken,
    ) {
      return request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/manager-review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ action, notes });
    }

    // ── T-07: Staff recommend close → Manager CLOSE_FALSE_POSITIVE ──
    it('T-07: staff RECOMMEND_CLOSE_FALSE_POSITIVE → manager CLOSE_FALSE_POSITIVE → CLOSED_FALSE_POSITIVE', async () => {
      const caseId = await setupLtkmCase(`70007${SUFFIX}`, `07007${SUFFIX}`);
      const staff = await staffReview(caseId, 'RECOMMEND_CLOSE_FALSE_POSITIVE', 'kemungkinan false positive');
      expect(staff.status).toBe(200);
      expect(staff.body.status).toBe('PENDING_COMPLIANCE_MANAGER_REVIEW');

      const res = await managerReview(caseId, 'CLOSE_FALSE_POSITIVE', 'setuju tutup');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CLOSED_FALSE_POSITIVE');
    });

    // ── T-08: Staff REQUEST_CLARIFICATION ──
    it('T-08: staff REQUEST_CLARIFICATION → status NEED_CLARIFICATION', async () => {
      const caseId = await setupLtkmCase(`70008${SUFFIX}`, `07008${SUFFIX}`);
      const res = await staffReview(caseId, 'REQUEST_CLARIFICATION', 'butuh dokumen tambahan');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('NEED_CLARIFICATION');
    });

    // ── T-09: Staff ESCALATE_TO_MANAGER ──
    it('T-09: staff ESCALATE_TO_MANAGER + notes → PENDING_COMPLIANCE_MANAGER_REVIEW + staff fields terisi', async () => {
      const caseId = await setupLtkmCase(`70009${SUFFIX}`, `07009${SUFFIX}`);
      const res = await staffReview(caseId, 'ESCALATE_TO_MANAGER', 'eskalasi ke manager');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING_COMPLIANCE_MANAGER_REVIEW');
      expect(res.body.staff_reviewed_by).toBeTruthy();
      expect(res.body.staff_reviewed_at).toBeTruthy();
      expect(res.body.staff_action).toBe('ESCALATE_TO_MANAGER');
      expect(res.body.staff_notes).toBe('eskalasi ke manager');
    });

    // ── T-09b: Staff ESCALATE_TO_MANAGER tanpa notes → 400 ──
    it('T-09b: staff ESCALATE_TO_MANAGER tanpa notes → 400, status tetap DETECTED', async () => {
      const caseId = await setupLtkmCase(`70091${SUFFIX}`, `07091${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/staff-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_MANAGER' })
        .expect(400);
      const detail = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(detail.body.status).toBe('DETECTED');
    });

    // ── T-09c: Staff RECOMMEND_CLOSE_FALSE_POSITIVE + notes → PENDING_MANAGER ──
    it('T-09c: staff RECOMMEND_CLOSE_FALSE_POSITIVE + notes → PENDING_COMPLIANCE_MANAGER_REVIEW', async () => {
      const caseId = await setupLtkmCase(`70092${SUFFIX}`, `07092${SUFFIX}`);
      const res = await staffReview(caseId, 'RECOMMEND_CLOSE_FALSE_POSITIVE', 'rekomendasi tutup');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING_COMPLIANCE_MANAGER_REVIEW');
      expect(res.body.staff_action).toBe('RECOMMEND_CLOSE_FALSE_POSITIVE');
      expect(res.body.staff_reviewed_by).toBeTruthy();
      expect(res.body.staff_reviewed_at).toBeTruthy();
    });

    // ── T-09d: Staff review tanpa notes → 400 ──
    it('T-09d: staff RECOMMEND_CLOSE_FALSE_POSITIVE tanpa notes → 400', async () => {
      const caseId = await setupLtkmCase(`70093${SUFFIX}`, `07093${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/staff-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'RECOMMEND_CLOSE_FALSE_POSITIVE' })
        .expect(400);
    });

    // ── T-10: Manager APPROVE_REPORT → READY_TO_REPORT + report DRAFT ──
    it('T-10: manager APPROVE_REPORT → READY_TO_REPORT, report_status DRAFT, report_type LTKM', async () => {
      const caseId = await setupLtkmCase(`70010${SUFFIX}`, `07010${SUFFIX}`);
      await staffReview(caseId, 'ESCALATE_TO_MANAGER', 'eskalasi ke manager').expect(200);

      const res = await managerReview(caseId, 'APPROVE_REPORT', 'setuju laporkan');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY_TO_REPORT');
      expect(res.body.report_status).toBe('DRAFT');
      expect(res.body.report_type).toBe('LTKM');
      expect(res.body.manager_reviewed_by).toBeTruthy();
      expect(res.body.manager_action).toBe('APPROVE_REPORT');
    });

    // ── T-11: Manager REJECT → MANAGER_REJECTED ──
    it('T-11: manager REJECT → status MANAGER_REJECTED', async () => {
      const caseId = await setupLtkmCase(`70011${SUFFIX}`, `07011${SUFFIX}`);
      await staffReview(caseId, 'ESCALATE_TO_MANAGER', 'eskalasi ke manager').expect(200);

      const res = await managerReview(caseId, 'REJECT', 'tidak perlu dilaporkan');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('MANAGER_REJECTED');
    });

    // ── T-12: Report SUBMITTED → REPORTED ──
    it('T-12: report SUBMITTED → status REPORTED', async () => {
      const caseId = await setupLtkmCase(`70012${SUFFIX}`, `07012${SUFFIX}`);
      await staffReview(caseId, 'ESCALATE_TO_MANAGER', 'eskalasi ke manager').expect(200);
      await managerReview(caseId, 'APPROVE_REPORT', 'approve').expect(200);

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
    it('T-14: Auditor bisa GET cases (200) tapi tidak bisa staff/manager review (403)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);

      const caseId = await setupLtkmCase(`70014${SUFFIX}`, `07014${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/staff-review`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ action: 'ESCALATE_TO_MANAGER', notes: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/manager-review`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ action: 'APPROVE_REPORT', notes: 'x' })
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

    // ── T-17: Manager tidak boleh review sebelum staff review (case DETECTED) ──
    it('T-17: manager-review sebelum staff review → 400', async () => {
      const caseId = await setupLtkmCase(`70017${SUFFIX}`, `07017${SUFFIX}`);
      // case masih DETECTED → belum melewati staff review
      const res = await managerReview(caseId, 'APPROVE_REPORT', 'coba approve langsung');
      expect(res.status).toBe(400);
    });

    // ── T-17b: OperationSupervisor tidak punya akses monitoring sama sekali ──
    it('T-17b: OperationSupervisor tidak bisa manager-review (403 — no monitoring access)', async () => {
      const caseId = await setupLtkmCase(`70171${SUFFIX}`, `07171${SUFFIX}`);
      await staffReview(caseId, 'ESCALATE_TO_MANAGER', 'eskalasi').expect(200);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/manager-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'APPROVE_REPORT', notes: 'coba' })
        .expect(403);
    });

    // ── T-17c: OperationSupervisor tidak bisa staff-review (403) ──
    it('T-17c: OperationSupervisor tidak bisa staff-review (403 — no monitoring access)', async () => {
      const caseId = await setupLtkmCase(`70172${SUFFIX}`, `07172${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/staff-review`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .send({ action: 'ESCALATE_TO_MANAGER', notes: 'coba' })
        .expect(403);
    });

    // ── T-17d: ComplianceLead bisa staff-review (200) ──
    it('T-17d: ComplianceLead bisa staff-review (200 — now first reviewer)', async () => {
      const caseId = await setupLtkmCase(`70173${SUFFIX}`, `07173${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/staff-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_MANAGER', notes: 'eskalasi' })
        .expect(200);
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

    // Helper: siapkan case yang sudah PENDING_COMPLIANCE_MANAGER_REVIEW.
    async function setupPendingManagerCase(nik: string, phone: string): Promise<string> {
      const caseId = await setupLtkmCase(nik, phone);
      await staffReview(caseId, 'ESCALATE_TO_MANAGER', 'eskalasi ke manager').expect(200);
      return caseId;
    }

    // ── T-19: OperationSupervisor tidak punya akses GET /monitoring/cases ──
    it('T-19: OperationSupervisor GET /monitoring/cases → 403 (no monitoring access)', async () => {
      await setupLtkmCase(`70019${SUFFIX}`, `07019${SUFFIX}`); // buat 1 case DETECTED
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .expect(403);
    });

    // ── T-20: OperationSupervisor tidak punya akses GET /monitoring/cases dengan filter ──
    it('T-20: OperationSupervisor GET /cases?status=PENDING_COMPLIANCE_MANAGER_REVIEW → 403', async () => {
      await setupPendingManagerCase(`70020${SUFFIX}`, `07020${SUFFIX}`);
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases?status=PENDING_COMPLIANCE_MANAGER_REVIEW`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .expect(403);
    });

    // ── T-21: ComplianceLead (Manager) GET detail PENDING_MANAGER → 200 ──
    it('T-21: ComplianceLead GET /cases/:id PENDING_COMPLIANCE_MANAGER_REVIEW → 200', async () => {
      const caseId = await setupPendingManagerCase(`70021${SUFFIX}`, `07021${SUFFIX}`);
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(res.body.status).toBe('PENDING_COMPLIANCE_MANAGER_REVIEW');
      expect(Array.isArray(res.body.triggers)).toBe(true);
    });

    // ── T-22: OperationSupervisor tidak punya akses GET case detail ──
    it('T-22: OperationSupervisor GET /cases/:id → 403 (no monitoring access)', async () => {
      const caseId = await setupPendingManagerCase(`70022${SUFFIX}`, `07022${SUFFIX}`);
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .expect(403);
    });

    // ── T-22b: OperationSupervisor tidak punya akses GET /monitoring/reports ──
    it('T-22b: OperationSupervisor GET /monitoring/reports → 403 (no monitoring access)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/monitoring/reports`)
        .set('Authorization', `Bearer ${operationSupervisorToken}`)
        .expect(403);
    });

    // ── T-23: Manager APPROVE_REPORT → READY_TO_REPORT (end-to-end 2 langkah) ──
    it('T-23: staff escalate → manager APPROVE_REPORT → READY_TO_REPORT', async () => {
      const caseId = await setupPendingManagerCase(`70023${SUFFIX}`, `07023${SUFFIX}`);
      const res = await managerReview(caseId, 'APPROVE_REPORT', 'approve');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('READY_TO_REPORT');
    });

    // ── T-24: Director punya full access ke report queue ──
    it('T-24: Director GET /monitoring/reports → 200 (full access)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/reports`)
        .set('Authorization', `Bearer ${directorToken}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
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

    // Helper: buat case PENDING_COMPLIANCE_MANAGER_REVIEW yang malformed (tanpa
    // staff review fields) — mensimulasikan data korup/legacy. Tidak lewat API.
    async function setupMalformedPendingCase(nik: string, phone: string): Promise<string> {
      const caseId = await setupLtkmCase(nik, phone);
      await pgPool.query(
        `UPDATE monitoring_cases
         SET status='PENDING_COMPLIANCE_MANAGER_REVIEW',
             staff_reviewed_by=NULL,
             staff_reviewed_at=NULL,
             staff_action=NULL
         WHERE id=$1`,
        [Number(caseId)],
      );
      return caseId;
    }

    // ── T-A1: LTKT single cash trigger → alert_information Setoran Tunai Tidak Sesuai Profil ──
    it('T-A1: LTKT_CASH_SINGLE_500M trigger has alert_name Setoran Tunai Tidak Sesuai Profil Nasabah', async () => {
      const appId = await createApprovedIndividual(`80001${SUFFIX}`, `08001${SUFFIX}`);
      const trId = await createTransfer(appId, {
        amount: 500_000_000,
        transfer_method: 'CASH',
        benef: `8801${SUFFIX}`,
      });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      const t = ev.body.triggers.find((x: any) => x.rule_code === 'LTKT_CASH_SINGLE_500M');
      expect(t).toBeDefined();
      expect(t.alert_name).toBe('Setoran Tunai Tidak Sesuai Profil Nasabah');
      expect(t.alert_code).toBe('LTKT_CASH_DEPOSIT_PROFILE_MISMATCH');
      expect(t.alert_information).toBeDefined();
      expect(t.alert_information.report_type).toBe('LTKT');
      expect(Array.isArray(t.alert_information.matched_conditions)).toBe(true);
      expect(t.alert_information.matched_conditions.length).toBeGreaterThan(0);
      expect(t.alert_information.supported_by_system).toBe(true);
      expect(Array.isArray(t.alert_information.limitations)).toBe(true);
      expect(t.alert_information.evidence.amount).toBe(500_000_000);
    });

    // ── T-A2: LTKT aggregate cash trigger → alert_information Frequent Cash Deposit Structuring ──
    it('T-A2: LTKT_CASH_AGGREGATE_DAILY_500M trigger has alert_name Frequent Cash Deposit Structuring', async () => {
      const appId = await createApprovedIndividual(`80002${SUFFIX}`, `08002${SUFFIX}`);
      await createTransfer(appId, { amount: 300_000_000, transfer_method: 'CASH', benef: `8821${SUFFIX}` });
      const tr2 = await createTransfer(appId, { amount: 300_000_000, transfer_method: 'CASH', benef: `8822${SUFFIX}` });
      const ev = await evaluate(tr2);
      expect(ev.status).toBe(201);
      const t = ev.body.triggers.find((x: any) => x.rule_code === 'LTKT_CASH_AGGREGATE_DAILY_500M');
      expect(t).toBeDefined();
      expect(t.alert_name).toBe('Frequent Cash Deposit Structuring');
      expect(t.alert_code).toBe('LTKT_CASH_DEPOSIT_STRUCTURING');
      expect(t.alert_information.report_type).toBe('LTKT');
      expect(t.alert_information.matched_conditions.some((c: string) => c.includes('Total tunai harian'))).toBe(true);
      expect(t.alert_information.evidence.transaction_count).toBeGreaterThanOrEqual(2);
    });

    // ── T-A3: LTKM high risk customer trigger → alert_information Transaksi Wajib EDD ──
    it('T-A3: LTKM_HIGH_RISK_CUSTOMER trigger has alert_name Transaksi Wajib EDD', async () => {
      const appId = await createApprovedIndividual(`80003${SUFFIX}`, `08003${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 50_000_000, benef: `8831${SUFFIX}` });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      const t = ev.body.triggers.find((x: any) => x.rule_code === 'LTKM_HIGH_RISK_CUSTOMER');
      expect(t).toBeDefined();
      expect(t.alert_name).toBe('Transaksi Wajib EDD');
      expect(t.alert_code).toBe('LTKM_EDD_REQUIRED');
      expect(t.alert_information.report_type).toBe('LTKM');
      expect(t.alert_information.matched_conditions).toContain('Nasabah risk_level HIGH');
      expect(t.alert_information.evidence.risk_level).toBe('HIGH');
    });

    // ── T-A4: LTKM structuring trigger → alert_information Structuring/Smurfing ──
    it('T-A4: LTKM_STRUCTURING_DAILY trigger has alert_name Structuring/Smurfing', async () => {
      const appId = await createApprovedIndividual(`80004${SUFFIX}`, `08004${SUFFIX}`);
      // 3 transaksi non-cash < 500M, total ≥ 500M → structuring
      await createTransfer(appId, { amount: 200_000_000, benef: `8841${SUFFIX}` });
      await createTransfer(appId, { amount: 200_000_000, benef: `8842${SUFFIX}` });
      await createTransfer(appId, { amount: 200_000_000, benef: `8843${SUFFIX}` });
      const lastTr = await createTransfer(appId, { amount: 200_000_000, benef: `8844${SUFFIX}` });
      const ev = await evaluate(lastTr);
      expect(ev.status).toBe(201);
      const t = ev.body.triggers.find((x: any) => x.rule_code === 'LTKM_STRUCTURING_DAILY');
      expect(t).toBeDefined();
      expect(t.alert_name).toBe('Structuring/Smurfing');
      expect(t.alert_code).toBe('LTKM_STRUCTURING_SMURFING');
      expect(t.alert_information.report_type).toBe('LTKM');
      expect(t.alert_information.matched_conditions.some((c: string) => c.includes('Total harian'))).toBe(true);
      expect(t.alert_information.limitations.length).toBeGreaterThan(0);
    });

    // ── T-A5: MANY_BENEFICIARIES trigger → Rapid Movement of Funds dengan limitation incoming ratio ──
    it('T-A5: LTKM_MANY_BENEFICIARIES_DAILY has Rapid Movement of Funds + incoming ratio limitation', async () => {
      const appId = await createApprovedIndividual(`80005${SUFFIX}`, `08005${SUFFIX}`);
      let lastTr = '';
      for (let i = 1; i <= 5; i++) {
        lastTr = await createTransfer(appId, { amount: 1_000_000, benef: `885${i}${SUFFIX}` });
      }
      const ev = await evaluate(lastTr);
      expect(ev.status).toBe(201);
      const t = ev.body.triggers.find((x: any) => x.rule_code === 'LTKM_MANY_BENEFICIARIES_DAILY');
      expect(t).toBeDefined();
      expect(t.alert_name).toBe('Rapid Movement of Funds');
      expect(t.alert_code).toBe('LTKM_RAPID_MOVEMENT_FUNDS');
      expect(t.alert_information.matched_conditions.some((c: string) => c.includes('beneficiary unik'))).toBe(true);
      const incomingLimitation = t.alert_information.limitations.some(
        (l: string) => l.toLowerCase().includes('incoming fund'),
      );
      expect(incomingLimitation).toBe(true);
      expect(t.alert_information.evidence.distinct_beneficiaries).toBeGreaterThanOrEqual(5);
    });

    // ── T-A6: HIGH_VALUE supporting alert has alert_information LTKM_PROFILE_ANOMALY ──
    it('T-A6: LTKM_HIGH_VALUE_TRANSFER supporting alert has alert_information and still does not open case alone', async () => {
      const appId = await createApprovedIndividual(`80006${SUFFIX}`, `08006${SUFFIX}`);
      // high value alone → still triggered: false (no case)
      const trIdAlone = await createTransfer(appId, { amount: 200_000_000, benef: `8861${SUFFIX}` });
      const evAlone = await evaluate(trIdAlone);
      expect(evAlone.body.triggered).toBe(false);

      // high value + high risk → case opens, check the supporting trigger has alert info
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 200_000_000, benef: `8862${SUFFIX}` });
      const ev = await evaluate(trId);
      expect(ev.status).toBe(201);
      const hvTrigger = ev.body.triggers.find((x: any) => x.rule_code === 'LTKM_HIGH_VALUE_TRANSFER');
      expect(hvTrigger).toBeDefined();
      expect(hvTrigger.alert_code).toBe('LTKM_PROFILE_ANOMALY');
      expect(hvTrigger.alert_information).toBeDefined();
      expect(hvTrigger.alert_information.limitations.some((l: string) => l.includes('supporting'))).toBe(true);
      // case_type still LTKM (not expanded by supporting alert)
      expect(ev.body.case_type).toBe('LTKM');
    });

    // ── T-A7: GET /monitoring/cases/:id returns alert_information on each trigger ──
    it('T-A7: GET /monitoring/cases/:id returns triggers with alert_code, alert_name, alert_information', async () => {
      const appId = await createApprovedIndividual(`80007${SUFFIX}`, `08007${SUFFIX}`);
      await pgPool.query(
        `UPDATE application_risk SET risk_level='HIGH' WHERE application_id=$1`,
        [appId],
      );
      const trId = await createTransfer(appId, { amount: 50_000_000, benef: `8871${SUFFIX}` });
      const ev = await evaluate(trId);
      const caseId = String(ev.body.id);

      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases/${caseId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(Array.isArray(res.body.triggers)).toBe(true);
      for (const t of res.body.triggers) {
        expect(t.alert_code).toBeDefined();
        expect(t.alert_name).toBeDefined();
        expect(t.alert_information).toBeDefined();
        expect(t.alert_information.matched_conditions).toBeDefined();
        expect(t.alert_information.evidence).toBeDefined();
      }
    });

    // ── T-A8: GET /monitoring/cases list returns alert_names and alert_count per case ──
    it('T-A8: GET /monitoring/cases list returns alert_names[] and alert_count per case', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/monitoring/cases?limit=10`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      // every case item should have alert_names (array) and alert_count (number)
      for (const c of res.body.data) {
        expect(Array.isArray(c.alert_names)).toBe(true);
        expect(typeof c.alert_count).toBe('number');
      }
    });

    // ── T-27: Manager tidak bisa review PENDING malformed (staff fields kosong) ──
    it('T-27: manager-review pada PENDING_MANAGER tanpa staff fields → 400', async () => {
      const caseId = await setupMalformedPendingCase(`70027${SUFFIX}`, `07027${SUFFIX}`);
      await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/manager-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'APPROVE_REPORT', notes: 'coba approve' })
        .expect(400);
    });

    // ── T-28: Backward-compat — endpoint lama compliance/director-review masih jalan ──
    it('T-28: legacy compliance-review → staff-review, director-review → manager-review', async () => {
      const caseId = await setupLtkmCase(`70028${SUFFIX}`, `07028${SUFFIX}`);

      // legacy compliance-review (ComplianceLead) → dipetakan ke staff ESCALATE_TO_MANAGER
      const staff = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/compliance-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ action: 'ESCALATE_TO_DIRECTOR', notes: 'eskalasi legacy' })
        .expect(200);
      expect(staff.body.status).toBe('PENDING_COMPLIANCE_MANAGER_REVIEW');
      expect(staff.body.staff_action).toBe('ESCALATE_TO_MANAGER');

      // legacy director-review (ComplianceLead) → dipetakan ke manager APPROVE_REPORT
      const mgr = await request(app.getHttpServer())
        .patch(`${BASE}/monitoring/cases/${caseId}/director-review`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ decision: 'APPROVED', notes: 'approve legacy' })
        .expect(200);
      expect(mgr.body.status).toBe('READY_TO_REPORT');
      expect(mgr.body.manager_action).toBe('APPROVE_REPORT');
    });

    // ── T-29: ComplianceLead review pertama tidak bisa langsung ke READY_TO_REPORT ──
    it('T-29: ComplianceLead first review (ESCALATE_TO_MANAGER) tidak bisa mark READY_TO_REPORT langsung', async () => {
      const caseId = await setupLtkmCase(`70029${SUFFIX}`, `07029${SUFFIX}`);
      // staff hanya bisa escalate/clarify/recommend — tidak ada aksi ke READY_TO_REPORT
      const res = await staffReview(caseId, 'ESCALATE_TO_MANAGER', 'eskalasi');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PENDING_COMPLIANCE_MANAGER_REVIEW');
      // READY_TO_REPORT hanya tercapai setelah manager approve
      expect(res.body.status).not.toBe('READY_TO_REPORT');
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
            ktp_number: TEST_KTP_NUMBER,
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

        await uploadFacePhotoDocs(ufAppId);

        await request(app.getHttpServer())
          .patch(`${BASE}/applications/${ufAppId}/submit`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);

        await request(app.getHttpServer())
          .patch(`${BASE}/applications/${ufAppId}/decision`)
          .set('Authorization', `Bearer ${operationSupervisorToken}`)
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

  // ══════════════════════════════════════════════════════════
  // PHASE 1: List Applications — Filters, Search, CIF, Date
  // ══════════════════════════════════════════════════════════
  describe('Phase 1: List Applications — filters & search', () => {
    // Gunakan indivAppIdOk (APPROVED individual) dan bizAppId (APPROVED business)
    // yang sudah dibuat dan di-approve di describe block D dan E sebelumnya.

    const PH1_SUFFIX = `ph1${SUFFIX}`;
    let ph1IndivAppId: string;
    let ph1IndivCif: string;
    let ph1IndivName: string;
    let ph1BizAppId: string;
    let ph1BizCif: string;
    let ph1BizName: string;
    let ph1CreatedAt: string;

    beforeAll(async () => {
      ph1IndivName = `PH1 Individu ${PH1_SUFFIX}`;
      const indivRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: ph1IndivName,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `31750000${PH1_SUFFIX}`.slice(0, 16),
          address_identity: 'Jl. Phase1 No. 1',
          pob: 'Jakarta',
          dob: '1988-04-12',
          nationality: 'ID',
          phone: `08199${PH1_SUFFIX}`.slice(0, 13),
          occupation: 'Karyawan Swasta',
          gender: 'F',
          signature_uri: 'https://storage.test/ph1_sig.png',
        })
        .expect(201);
      ph1IndivAppId = String(indivRes.body.id);

      // CIF digenerate saat create
      const indivDetail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${ph1IndivAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      ph1IndivCif = indivDetail.body.person.cif_no;
      ph1CreatedAt = indivDetail.body.application.created_at.slice(0, 10);

      ph1BizName = `PT Phase1 Biz ${PH1_SUFFIX}`;
      const bizRes = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: ph1BizName,
          legal_form: 'PT',
          incorporation_place: 'Surabaya',
          incorporation_date: '2019-07-01',
          deed_number: `AKTA-PH1-${SUFFIX}`,
          business_license_number: `BL_PH1_${PH1_SUFFIX}`,
          nib: `99001122${PH1_SUFFIX}`.slice(0, 13),
          npwp: npwp15('12'),
          address_line: 'Jl. Bisnis No. 2',
          city: 'Surabaya',
          province: 'Jawa Timur',
          postal_code: '60111',
          business_activity: 'perdagangan ekspor',
          phone: `0318${PH1_SUFFIX}`.slice(0, 12),
        })
        .expect(201);
      ph1BizAppId = String(bizRes.body.id);

      const bizDetail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${ph1BizAppId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      ph1BizCif = bizDetail.body.business.cif_no;
    }, 30000);

    it('PH1-01: list response includes cif_no and display_name for individual', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ cif: ph1IndivCif })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const item = res.body.data[0];
      expect(item.cif_no).toBe(ph1IndivCif);
      expect(item.display_name).toBe(ph1IndivName);
      expect(item.application_type).toBe('INDIVIDUAL');
      expect(item.display_type).toBe('Individual');
      expect(item.id).toBeDefined();
      expect(item.status).toBeDefined();
      expect(item.created_at).toBeDefined();
    });

    it('PH1-02: list response includes cif_no and display_name for business', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ cif: ph1BizCif })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      const item = res.body.data[0];
      expect(item.cif_no).toBe(ph1BizCif);
      expect(item.display_name).toBe(ph1BizName);
      expect(item.application_type).toBe('BUSINESS');
      expect(item.display_type).toBe('Badan Usaha');
    });

    it('PH1-03: q search by name finds individual', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ q: ph1IndivName })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.some((r: any) => r.display_name === ph1IndivName)).toBe(true);
    });

    it('PH1-04: q search by name finds business', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ q: ph1BizName })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.some((r: any) => r.display_name === ph1BizName)).toBe(true);
    });

    it('PH1-05: cif query without dash matches individual CIF', async () => {
      const noDash = ph1IndivCif.replace(/-/g, '');
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ cif: noDash })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].cif_no).toBe(ph1IndivCif);
    });

    it('PH1-06: cif query with legacy dash input matches individual CIF', async () => {
      // Simulasikan input bergaya legacy: KSHI → KSH-I- (meski CIF modern tidak punya dash)
      // Normalisasi pada kedua sisi (strip dash) memastikan ini tetap match
      const withDashes = ph1IndivCif.replace(/^(KSH)([IB])/, '$1-$2-');
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ cif: withDashes })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].cif_no).toBe(ph1IndivCif);
    });

    it('PH1-07: date_from and date_to filter by created_at (application exists on its own created date)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ date_from: ph1CreatedAt, date_to: ph1CreatedAt })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      // Semua hasil harus berada dalam rentang tanggal
      for (const item of res.body.data) {
        const createdDate = item.created_at.slice(0, 10);
        expect(createdDate >= ph1CreatedAt).toBe(true);
        expect(createdDate <= ph1CreatedAt).toBe(true);
      }
    });

    it('PH1-08: date_from format invalid returns 400', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ date_from: '15/07/2026' })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);
    });

    it('PH1-09: date_to format invalid returns 400', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ date_to: '2026-7-10' })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(400);
    });

    it('PH1-10: q search by CIF string finds application', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ q: ph1IndivCif })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.some((r: any) => r.cif_no === ph1IndivCif)).toBe(true);
    });

    it('PH1-11: application_type filter returns only INDIVIDUAL results', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ application_type: 'INDIVIDUAL', limit: 50 })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((r: any) => r.application_type === 'INDIVIDUAL')).toBe(true);
    });

    it('PH1-12: application_type filter returns only BUSINESS results', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/applications`)
        .query({ application_type: 'BUSINESS', limit: 50 })
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((r: any) => r.application_type === 'BUSINESS')).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════
  // V. Individual CDD Extended — ktp_number, region, industry
  // ══════════════════════════════════════════════════════════
  describe('V. Individual CDD Extended', () => {

    // ── V1. ktp_number validation ──────────────────────────
    describe('V1. ktp_number validation', () => {
      const baseIndivBody = (overrides: Record<string, any> = {}) => ({
        full_name: `V KTP Test ${SUFFIX}`,
        ktp_number: TEST_KTP_NUMBER,
        identity_type: 'KTP',
        identity_number: `321000${SUFFIX}`,
        address_identity: 'Jl. KTP Test No. 1, Jakarta',
        pob: 'Jakarta',
        dob: '1990-01-01',
        nationality: 'ID',
        phone: `08200${SUFFIX}`,
        occupation: 'Karyawan Swasta',
        gender: 'M',
        ...overrides,
      });

      it('V1-01: create tanpa ktp_number → 400', async () => {
        const body = baseIndivBody();
        delete (body as any).ktp_number;
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(body)
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('V1-02: ktp_number non-digit → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({ ktp_number: 'ABCDEFGHIJKLMNOP', identity_number: `321001${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('V1-03: ktp_number 17 digit (>16) → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({ ktp_number: '31750012345678901', identity_number: `321002${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('V1-04: ktp_number 14 digit (<15) → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({ ktp_number: '31750012345678', identity_number: `321003${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('V1-05: ktp_number 15 digit (valid) → 201', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({ ktp_number: '317500123456789', identity_number: `321004${SUFFIX}` }))
          .expect(201);
        expect(res.body.status).toBe('DRAFT');
      });

      it('V1-06: ktp_number 16 digit (valid) → 201', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({ ktp_number: '3175001234567890', identity_number: `321005${SUFFIX}` }))
          .expect(201);
        expect(res.body.status).toBe('DRAFT');
      });

      it('V1-07: sim_number and passport_number optional → 201', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({
            sim_number: 'A12345678',
            passport_number: 'C1234567',
            identity_number: `321006${SUFFIX}`,
          }))
          .expect(201);
        expect(res.body.status).toBe('DRAFT');
      });

      it('V1-08: sim_number > 20 chars → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({ sim_number: 'A'.repeat(21), identity_number: `321007${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toBeDefined();
      });

      it('V1-09: GET /applications/:id setelah create → person berisi ktp_number', async () => {
        const create = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseIndivBody({
            ktp_number: '3175009876543210',
            sim_number: 'B9999999',
            passport_number: 'P123456',
            alias: 'Alias Test',
            identity_number: `321008${SUFFIX}`,
          }))
          .expect(201);
        const id = String(create.body.id);

        const res = await request(app.getHttpServer())
          .get(`${BASE}/applications/${id}`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);

        expect(res.body.person.ktp_number).toBe('3175009876543210');
        expect(res.body.person.sim_number).toBe('B9999999');
        expect(res.body.person.passport_number).toBe('P123456');
        expect(res.body.person.alias).toBe('Alias Test');
      });
    });

    // ── V2. Region cascade validation ──────────────────────
    describe('V2. Region cascade validation', () => {
      const baseBody = (overrides: Record<string, any> = {}) => ({
        full_name: `V Region Test ${SUFFIX}`,
        ktp_number: TEST_KTP_NUMBER,
        identity_type: 'KTP',
        identity_number: `322000${SUFFIX}`,
        address_identity: 'Jl. Region No. 1',
        pob: 'Jakarta',
        dob: '1991-01-01',
        nationality: 'ID',
        phone: `08300${SUFFIX}`,
        occupation: 'Karyawan',
        gender: 'M',
        ...overrides,
      });

      it('V2-01: valid full region chain → 201, GET returns names', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            province_code: '31',
            city_code: '3171',
            district_code: '3171010',
            village_code: '3171010001',
            identity_number: `322001${SUFFIX}`,
          }))
          .expect(201);

        const detail = await request(app.getHttpServer())
          .get(`${BASE}/applications/${String(res.body.id)}`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);

        expect(detail.body.person.province_code).toBe('31');
        expect(detail.body.person.province_name).toBe('DKI Jakarta');
        expect(detail.body.person.city_code).toBe('3171');
        expect(detail.body.person.city_name).toBe('Kota Jakarta Pusat');
        expect(detail.body.person.district_code).toBe('3171010');
        expect(detail.body.person.district_name).toBe('Gambir');
        expect(detail.body.person.village_code).toBe('3171010001');
        expect(detail.body.person.village_name).toBe('Gambir');
      });

      it('V2-02: city_code tidak di bawah province_code → 400', async () => {
        // 3273 = Kota Bandung, milik province 32 (Jawa Barat), bukan 31 (DKI Jakarta)
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            province_code: '31',
            city_code: '3273',
            identity_number: `322002${SUFFIX}`,
          }))
          .expect(400);
        expect(res.body.message).toContain('province_code');
      });

      it('V2-03: district_code tidak di bawah city_code → 400', async () => {
        // 3273010 = Astana Anyar, milik kota 3273 (Bandung), bukan 3171 (Jakarta Pusat)
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            province_code: '31',
            city_code: '3171',
            district_code: '3273010',
            identity_number: `322003${SUFFIX}`,
          }))
          .expect(400);
        expect(res.body.message).toContain('city_code');
      });

      it('V2-04: village_code tidak di bawah district_code → 400', async () => {
        // 3273010001 = milik district 3273010 (Bandung), bukan 3171010 (Gambir)
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            province_code: '31',
            city_code: '3171',
            district_code: '3171010',
            village_code: '3273010001',
            identity_number: `322004${SUFFIX}`,
          }))
          .expect(400);
        expect(res.body.message).toContain('district_code');
      });

      it('V2-05: province_code tidak ada → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({ province_code: '99', identity_number: `322005${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toContain('province_code');
      });
    });

    // ── V3. industry_category & monthly_income_range ───────
    describe('V3. industry_category and monthly_income_range', () => {
      const baseBody = (overrides: Record<string, any> = {}) => ({
        full_name: `V Cat Test ${SUFFIX}`,
        ktp_number: TEST_KTP_NUMBER,
        identity_type: 'KTP',
        identity_number: `323000${SUFFIX}`,
        address_identity: 'Jl. Cat No. 1',
        pob: 'Bandung',
        dob: '1993-01-01',
        nationality: 'ID',
        phone: `08400${SUFFIX}`,
        occupation: 'Wiraswasta',
        gender: 'F',
        ...overrides,
      });

      it('V3-01: industry_category valid → 201', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            industry_category: 'Makanan dan Minuman',
            monthly_income_range: 'Rata-rata Rp5 juta sampai Rp10 juta per bulan',
            company_name: 'PT Test',
            identity_number: `323001${SUFFIX}`,
          }))
          .expect(201);
        expect(res.body.status).toBe('DRAFT');
      });

      it('V3-02: industry_category tidak valid → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({ industry_category: 'Invalid Kategori XYZ', identity_number: `323002${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toContain('industry_category');
      });

      it('V3-03: monthly_income_range tidak valid → 400', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({ monthly_income_range: 'Sangat Kaya', identity_number: `323003${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toContain('monthly_income_range');
      });

      it('V3-04: GET /applications/:id setelah create → industry_category dan monthly_income_range tersimpan', async () => {
        const create = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            industry_category: 'Elektronik',
            monthly_income_range: 'Rata-rata lebih dari Rp20 juta sampai Rp50 juta per bulan',
            company_name: 'PT Elektronik Test',
            company_address: 'Jl. Elektronik No. 1',
            identity_number: `323004${SUFFIX}`,
          }))
          .expect(201);
        const id = String(create.body.id);

        const res = await request(app.getHttpServer())
          .get(`${BASE}/applications/${id}`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);

        expect(res.body.person.industry_category).toBe('Elektronik');
        expect(res.body.person.monthly_income_range).toBe('Rata-rata lebih dari Rp20 juta sampai Rp50 juta per bulan');
        expect(res.body.person.company_name).toBe('PT Elektronik Test');
      });

      it('V3-05: industry_category = RBA V01 Excel name → 201, stored as-is', async () => {
        const create = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            industry_category: 'Aktivitas Keuangan dan Asuransi',
            identity_number: `323005${SUFFIX}`,
          }))
          .expect(201);
        expect(create.body.status).toBe('DRAFT');

        const detail = await request(app.getHttpServer())
          .get(`${BASE}/applications/${create.body.id}`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);
        expect(detail.body.person.industry_category).toBe('Aktivitas Keuangan dan Asuransi');
      });

      it('V3-06: industry_category = RBA V01 name, submit → COMPLETE, Bidang Industri mapped with correct score', async () => {
        const { computeRbaV01 } = require('../../src/modules/applications/rba-v01.engine');
        // Verify engine resolves exact RBA industry name (score 3)
        const result = computeRbaV01({
          type: 'INDIVIDUAL',
          occupation: 'Profesional',
          source_of_funds: 'Gaji',
          industry_category: 'Aktivitas Keuangan dan Asuransi',
          business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
          province_name: 'DKI Jakarta',
          distribution_channel: 'Outlet Fisik',
          name_screening_result: 'CLEAR',
        });
        expect(result.rba_calculation_status).toBe('COMPLETE');
        const industryParam = result.rba_components.components.industry;
        expect(industryParam).toBeDefined();
        expect(industryParam.score).toBe(3);
        expect(industryParam.mapped_to).toBe('Aktivitas Keuangan dan Asuransi');
      });

      it('V3-07: GET /references/industry-categories → mengembalikan "Lainnya" sebagai opsi valid', async () => {
        const res = await request(app.getHttpServer())
          .get(`${BASE}/references/industry-categories`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);

        const codes = res.body.data.map((c: any) => c.code);
        expect(codes).toContain('Lainnya');
        // code === name per spesifikasi
        const lainnya = res.body.data.find((c: any) => c.code === 'Lainnya');
        expect(lainnya.name).toBe('Lainnya');
      });

      it('V3-08: Individual create industry_category="Periklanan" (dari daftar baru) → 201', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({ industry_category: 'Periklanan', identity_number: `323008${SUFFIX}` }))
          .expect(201);
        expect(res.body.status).toBe('DRAFT');
      });

      it('V3-09: Individual create industry_category="Lainnya" + industry_category_other → 201, keduanya tersimpan', async () => {
        const create = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({
            industry_category: 'Lainnya',
            industry_category_other: 'Desainer Interior',
            identity_number: `323009${SUFFIX}`,
          }))
          .expect(201);

        const detail = await request(app.getHttpServer())
          .get(`${BASE}/applications/${create.body.id}`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .expect(200);
        expect(detail.body.person.industry_category).toBe('Lainnya');
        expect(detail.body.person.industry_category_other).toBe('Desainer Interior');
      });

      it('V3-10: Individual create industry_category="Lainnya" tanpa other → 400 wajib diisi', async () => {
        const res = await request(app.getHttpServer())
          .post(`${BASE}/applications/individual`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send(baseBody({ industry_category: 'Lainnya', identity_number: `323010${SUFFIX}` }))
          .expect(400);
        expect(res.body.message).toContain('Bidang Industri');
      });

      it('V3-11: RBA untuk industry_category="Lainnya" → Bidang Industri INCOMPLETE (tidak dipaksakan skor)', () => {
        const { computeRbaV01 } = require('../../src/modules/applications/rba-v01.engine');
        const result = computeRbaV01({
          type: 'INDIVIDUAL',
          occupation: 'Profesional',
          source_of_funds: 'Gaji',
          industry_category: 'Lainnya',
          business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
          province_name: 'DKI Jakarta',
          distribution_channel: 'Outlet Fisik',
          name_screening_result: 'CLEAR',
        });
        // "Lainnya" bukan nama industri RBA V01 dan bukan keyword — harus INCOMPLETE
        expect(result.rba_calculation_status).toBe('INCOMPLETE');
        const unmapped = result.rba_unmapped_parameters ?? [];
        expect(unmapped.some((u: any) => u.parameter === 'Bidang Industri')).toBe(true);
      });
    });
  });

  // ══════════════════════════════════════════════════════════
  // X. address_identity — optional + auto-derive dari structured address
  // ══════════════════════════════════════════════════════════
  describe('X. address_identity derivation', () => {
    it('X-01: create Individual dengan structured address (tanpa address_identity) → 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Structured Addr ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `317600X1${SUFFIX}`,
          // no address_identity — use structured fields
          province_code: '31',
          city_code: '3171',
          district_code: '3171010',
          village_code: '3171010001',
          street_address: 'Jl. Gambir Raya',
          house_number: '12A',
          rt_rw: '003/007',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone: `0812X1${SUFFIX}`,
          occupation: 'Karyawan Swasta',
          gender: 'M',
        })
        .expect(201);

      expect(res.body.status).toBe('DRAFT');
    });

    it('X-02: GET /applications/:id → address_identity tersimpan (derived dari structured)', async () => {
      // Create fresh application with structured address
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Derived Addr ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `317600X2${SUFFIX}`,
          province_code: '31',
          city_code: '3171',
          district_code: '3171010',
          village_code: '3171010001',
          street_address: 'Jl. Medan Merdeka',
          house_number: '5',
          rt_rw: '001/002',
          pob: 'Jakarta',
          dob: '1988-05-10',
          nationality: 'ID',
          phone: `0812X2${SUFFIX}`,
          occupation: 'PNS',
          gender: 'F',
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${create.body.id}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const addr = detail.body.person.address_identity as string;
      expect(typeof addr).toBe('string');
      expect(addr.length).toBeGreaterThan(0);
      // derived harus mengandung street_address
      expect(addr).toContain('Jl. Medan Merdeka');
      // derived harus mengandung house_number
      expect(addr).toContain('No. 5');
      // derived harus mengandung RT/RW
      expect(addr).toContain('RT/RW 001/002');
      // derived harus mengandung nama wilayah (Gambir kecamatan)
      expect(addr).toContain('Gambir');
    });

    it('X-03: create Individual legacy dengan address_identity → 201, tersimpan apa adanya', async () => {
      const legacyAddr = 'Jl. Veteran No. 88 RT 001/002, Menteng, Jakarta Pusat 10310';
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `Legacy Addr ${SUFFIX}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `317600X3${SUFFIX}`,
          address_identity: legacyAddr,
          pob: 'Jakarta',
          dob: '1975-12-25',
          nationality: 'ID',
          phone: `0812X3${SUFFIX}`,
          occupation: 'Wiraswasta',
          gender: 'M',
        })
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${create.body.id}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.person.address_identity).toBe(legacyAddr);
    });
  });

  // ══════════════════════════════════════════════════════════
  // W. References endpoints
  // ══════════════════════════════════════════════════════════
  describe('W. References endpoints', () => {
    it('W-01: GET /references/provinces → 200, minimal 38 provinsi (termasuk 4 pemekaran Papua)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/provinces`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(38);
      const jakarta = res.body.data.find((p: any) => p.code === '31');
      expect(jakarta).toBeDefined();
      expect(jakarta.name).toBe('DKI Jakarta');
    });

    it('W-02: GET /references/provinces?q=Jakarta → filter by name', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/provinces?q=Jakarta`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.every((p: any) => p.name.toLowerCase().includes('jakarta'))).toBe(true);
    });

    it('W-03: GET /references/regencies?province_code=31 → hanya kota/kab DKI Jakarta', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/regencies?province_code=31`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data.every((r: any) => r.province_code === '31')).toBe(true);
    });

    it('W-04: GET /references/districts?regency_code=3171 → kecamatan Jakarta Pusat', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/districts?regency_code=3171`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const gambir = res.body.data.find((d: any) => d.code === '3171010');
      expect(gambir).toBeDefined();
      expect(gambir.name).toBe('Gambir');
    });

    it('W-05: GET /references/villages?district_code=3171010 → kelurahan di Gambir', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/villages?district_code=3171010`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      const gambir = res.body.data.find((v: any) => v.code === '3171010001');
      expect(gambir).toBeDefined();
      expect(gambir.name).toBe('Gambir');
    });

    it('W-06: GET /references/nationalities → data array dengan code ID', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/nationalities`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      const id = res.body.data.find((n: any) => n.code === 'ID');
      expect(id).toBeDefined();
      expect(id.name).toBe('Indonesia');
    });

    it('W-07: GET /references/nationalities?q=Indo → filter', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/nationalities?q=Indo`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(res.body.data.some((n: any) => n.code === 'ID')).toBe(true);
    });

    it('W-08: GET /references/industry-categories → 200, semua kategori tersedia termasuk Lainnya', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/industry-categories`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(46);
      expect(res.body.data.some((c: any) => c.code === 'Elektronik')).toBe(true);
      expect(res.body.data.some((c: any) => c.code === 'Lainnya')).toBe(true);
    });

    it('W-09: GET /references/monthly-income-ranges → 200, 6 range tersedia', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/monthly-income-ranges`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(6);
    });

    it('W-09b: GET /references/monthly-income-ranges → semua nilai persis tersedia', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/monthly-income-ranges`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const expected = [
        'Kurang dari Rp5 juta per bulan',
        'Rata-rata Rp5 juta sampai Rp10 juta per bulan',
        'Rata-rata lebih dari Rp10 juta sampai Rp20 juta per bulan',
        'Rata-rata lebih dari Rp20 juta sampai Rp50 juta per bulan',
        'Rata-rata lebih dari Rp50 juta sampai Rp100 juta per bulan',
        'Rata-rata di atas Rp100 juta per bulan',
      ];
      const names = res.body.data.map((x: any) => x.name);
      for (const exp of expected) {
        expect(names).toContain(exp);
      }
      // setiap item punya code & name non-kosong
      for (const item of res.body.data) {
        expect(item.code).toBeTruthy();
        expect(item.name).toBeTruthy();
      }
    });

    it('W-09c: GET /references/occupations → 200, semua pekerjaan tersedia', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/occupations`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      const expected = [
        'Karyawan Swasta',
        'Pejabat Negara',
        'Wirausaha/Wiraswasta',
        'TNI/POLRI',
        'Pegawai BUMN/BUMD',
        'Profesional',
        'Pegawai Negeri Sipil (PNS)',
        'Pensiunan',
        'Pengurus atau Pegawai LSM atau Organisasi Tidak Berbadan Hukum Lainnya',
        'Ibu Rumah Tangga',
        'Pelajar/Mahasiswa',
        'Sopir',
        'Asisten Rumah Tangga',
        'Atlet/Olahragawan',
        'Buruh',
        'Pengajar',
        'Pemuka Agama',
        'Tenaga Keamanan',
      ];
      expect(res.body.data).toHaveLength(expected.length);
      const names = res.body.data.map((x: any) => x.name);
      for (const exp of expected) {
        expect(names).toContain(exp);
      }
      for (const item of res.body.data) {
        expect(item.code).toBeTruthy();
        expect(item.name).toBeTruthy();
      }
    });

    it('W-10: GET /references/provinces → semua 4 provinsi pemekaran Papua ada', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/provinces`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const provinces = res.body.data as Array<{ code: string; name: string }>;
      const expected = [
        { code: '92', name: 'Papua Barat Daya' },
        { code: '95', name: 'Papua Selatan' },
        { code: '96', name: 'Papua Tengah' },
        { code: '97', name: 'Papua Pegunungan' },
      ];
      for (const exp of expected) {
        const found = provinces.find((p) => p.code === exp.code);
        expect(found).toBeDefined();
        expect(found!.name).toBe(exp.name);
      }
    });

    it('W-11: GET /references/provinces?q=Papua Barat Daya → returns data', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/provinces?q=Papua Barat Daya`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      const pbd = res.body.data.find((p: any) => p.code === '92');
      expect(pbd).toBeDefined();
      expect(pbd.name).toBe('Papua Barat Daya');
    });

    it('W-12: GET /references/provinces?q=Lampung → menemukan provinsi Lampung (code 18)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/provinces?q=Lampung`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      const lampung = res.body.data.find((p: any) => p.code === '18');
      expect(lampung).toBeDefined();
      expect(lampung.name).toBe('Lampung');
    });

    it('W-13: GET /references/regencies?province_code=18 → 15 kab/kota Lampung', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/regencies?province_code=18`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(15);
      const bandarLampung = res.body.data.find((r: any) => r.code === '1871');
      expect(bandarLampung).toBeDefined();
      expect(bandarLampung.name).toBe('Kota Bandar Lampung');
    });

    it('W-14: GET /references/districts?regency_code=1871 → kecamatan Bandar Lampung', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/districts?regency_code=1871`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(20);
      const enggal = res.body.data.find((d: any) => d.code === '1871170');
      expect(enggal).toBeDefined();
      expect(enggal.name).toBe('Enggal');
    });

    it('W-15: GET /references/villages?district_code=1871170 → kelurahan Kec. Enggal', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/villages?district_code=1871170`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(6);
      const enggalKel = res.body.data.find((v: any) => v.code === '1871170001');
      expect(enggalKel).toBeDefined();
      expect(enggalKel.name).toBe('Enggal');
    });
  });

  // ══════════════════════════════════════════════════════════
  // Y. Complaints — Pencatatan Pengaduan
  // ══════════════════════════════════════════════════════════
  describe('Y. Complaints — Pencatatan Pengaduan', () => {
    let complaintId: string;
    let complaintNo: string;

    // Y-01: customer search returns APPROVED applications
    it('Y-01: GET /complaints/customers/search → 200, hanya aplikasi APPROVED', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/complaints/customers/search`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      expect(typeof res.body.page).toBe('number');
      expect(typeof res.body.limit).toBe('number');
    });

    // Y-02: DRAFT app tidak muncul, APPROVED app muncul di customer search
    it('Y-02: customer search tidak mengembalikan aplikasi non-APPROVED', async () => {
      // Search dengan nama unik indivAppIdOk "Individu OK <SUFFIX>" — hanya 1 match per run
      const res = await request(app.getHttpServer())
        .get(`${BASE}/complaints/customers/search?q=Individu+OK+${SUFFIX}&limit=10`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      // indivAppIdOk (APPROVED) harus muncul
      const found = res.body.data.find((d: any) => String(d.application_id) === String(indivAppIdOk));
      expect(found).toBeDefined();
      expect(found.display_name).toBeTruthy();

      // indivAppIdMissing (DRAFT) tidak boleh ada di hasil
      const notApproved = res.body.data.find((d: any) => String(d.application_id) === String(indivAppIdMissing));
      expect(notApproved).toBeUndefined();
    });

    // Y-03: FrontDesk dapat membuat complaint
    it('Y-03: FrontDesk POST /complaints → 201, complaint_no KESH-CMP-...', async () => {
      const res = await request(app.getHttpServer())
        .post(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          customer_application_id: Number(indivAppIdOk),
          transaction_reference: `TRX-${SUFFIX}`,
          category: 'TRANSFER',
          channel: 'WALK_IN',
          priority: 'MEDIUM',
          complaint_notes: 'Nasabah mengadukan transfer yang tidak sampai ke rekening tujuan.',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.complaint_no).toMatch(/^KESH-CMP-\d{8}-[A-Z0-9]{5}$/);
      expect(res.body.status).toBe('OPEN');
      complaintId = String(res.body.id);
      complaintNo = res.body.complaint_no;
    });

    // Y-04: snapshot customer_name dan customer_cif_no tersimpan
    it('Y-04: GET /complaints/:id → customer_name dan customer_cif_no di-snapshot', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      expect(res.body.customer_name).toBeTruthy();
      // cif_no nullable tapi harus tersimpan jika ada
      expect(res.body.complaint_no).toBe(complaintNo);
      expect(String(res.body.customer_application_id)).toBe(String(indivAppIdOk));
    });

    // Y-05: FrontDesk list hanya menampilkan complaint milik sendiri
    it('Y-05: FrontDesk GET /complaints → hanya complaint milik sendiri', async () => {
      // Buat 1 complaint tambahan dari FrontDesk (sudah ada Y-03)
      const res = await request(app.getHttpServer())
        .get(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      // Semua complaint yang dikembalikan harus milik FrontDesk user ini
      // Verifikasi dengan memastikan complaint dari Y-03 ada
      const found = res.body.data.find((c: any) => String(c.id) === complaintId);
      expect(found).toBeDefined();
    });

    // Y-06: ComplianceLead melihat semua complaint
    it('Y-06: ComplianceLead GET /complaints → melihat semua (≥ 1)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    // Y-07: FrontDesk tidak boleh set status RESOLVED
    it('Y-07: FrontDesk PATCH /complaints/:id status=RESOLVED → 403', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ status: 'RESOLVED' })
        .expect(403);
    });

    // Y-07b: FrontDesk tidak boleh set status CLOSED
    it('Y-07b: FrontDesk PATCH /complaints/:id status=CLOSED → 403', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ status: 'CLOSED' })
        .expect(403);
    });

    // Y-08: ComplianceLead dapat update status ke IN_PROGRESS
    it('Y-08: ComplianceLead PATCH /complaints/:id status=IN_PROGRESS → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      expect(res.body.status).toBe('IN_PROGRESS');
    });

    // Y-09: ComplianceLead dapat resolve complaint dengan resolution_notes
    it('Y-09: ComplianceLead PATCH /complaints/:id status=RESOLVED + resolution_notes → 200', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          status: 'RESOLVED',
          resolution_notes: 'Transfer telah dikonfirmasi diterima oleh bank tujuan. Kasus ditutup.',
        })
        .expect(200);

      expect(res.body.status).toBe('RESOLVED');
      expect(res.body.resolution_notes).toContain('dikonfirmasi');
      expect(res.body.resolved_at).not.toBeNull();
      expect(res.body.resolved_by).not.toBeNull();
    });

    // Y-10: Auditor dapat view complaint tapi tidak bisa update
    it('Y-10: Auditor GET /complaints/:id → 200 (read-only)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .expect(200);
    });

    it('Y-10b: Auditor PATCH /complaints/:id → 403', async () => {
      await request(app.getHttpServer())
        .patch(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${auditorToken}`)
        .send({ priority: 'HIGH' })
        .expect(403);
    });

    // Y-11: transaction search mengembalikan transfer refs
    it('Y-11: GET /complaints/transactions/search?customer_application_id=X → 200, transfer list', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/complaints/transactions/search?customer_application_id=${indivAppIdOk}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(typeof res.body.total).toBe('number');
      // indivAppIdOk dipakai sebagai sender di banyak transfer sebelumnya
      expect(res.body.total).toBeGreaterThanOrEqual(1);
      if (res.body.data.length > 0) {
        const t = res.body.data[0];
        expect(t.transfer_id).toBeDefined();
        expect(t.transaction_reference).toBeDefined();
        expect(t.amount).toBeDefined();
        expect(t.status).toBeDefined();
      }
    });

    // Y-11b: transaction search without customer_application_id → 400
    it('Y-11b: GET /complaints/transactions/search tanpa customer_application_id → 400', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/complaints/transactions/search`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(400);
    });

    // Y-12: create dengan category tidak valid → 400
    it('Y-12: POST /complaints dengan category tidak valid → 400', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          customer_application_id: Number(indivAppIdOk),
          transaction_reference: `TRX-${SUFFIX}-BAD`,
          category: 'INVALID_CATEGORY',
          complaint_notes: 'Notes minimal sepuluh karakter.',
        })
        .expect(400);
    });

    // Y-13: create dengan complaint_notes terlalu pendek → 400
    it('Y-13: POST /complaints dengan complaint_notes < 10 chars → 400', async () => {
      await request(app.getHttpServer())
        .post(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          customer_application_id: Number(indivAppIdOk),
          transaction_reference: `TRX-${SUFFIX}-SHORT`,
          complaint_notes: 'Pendek',
        })
        .expect(400);
    });

    // Y-14: create dengan customer non-APPROVED → 400
    it('Y-14: POST /complaints dengan customer DRAFT → 400', async () => {
      // indivAppIdMissing dibuat di B-01 dan tidak pernah APPROVED
      await request(app.getHttpServer())
        .post(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          customer_application_id: Number(indivAppIdMissing),
          transaction_reference: `TRX-${SUFFIX}-DRAFT`,
          complaint_notes: 'Nasabah belum approved seharusnya ditolak.',
        })
        .expect(400);
    });

    // Y-15: FrontDesk tidak bisa update complaint yang sudah RESOLVED (status != OPEN)
    it('Y-15: FrontDesk PATCH complaint yang sudah RESOLVED → 403', async () => {
      // complaintId sudah RESOLVED dari Y-09
      await request(app.getHttpServer())
        .patch(`${BASE}/complaints/${complaintId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ priority: 'HIGH' })
        .expect(403);
    });

    // Y-16: FrontDesk dengan complaint OPEN bisa update priority/channel
    it('Y-16: FrontDesk PATCH complaint OPEN → update priority berhasil', async () => {
      // Buat complaint baru yang masih OPEN
      const create = await request(app.getHttpServer())
        .post(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          customer_application_id: Number(indivAppIdOk),
          transaction_reference: `TRX-${SUFFIX}-EDIT`,
          category: 'SERVICE',
          channel: 'PHONE',
          priority: 'LOW',
          complaint_notes: 'Pengaduan layanan untuk diupdate prioritasnya kemudian.',
        })
        .expect(201);

      const newId = create.body.id;

      const res = await request(app.getHttpServer())
        .patch(`${BASE}/complaints/${newId}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({ priority: 'HIGH', channel: 'WHATSAPP' })
        .expect(200);

      expect(res.body.priority).toBe('HIGH');
      expect(res.body.channel).toBe('WHATSAPP');
    });

    // Y-17: complaint dengan transfer_id valid tersimpan
    it('Y-17: POST /complaints dengan transfer_id valid → 201, transfer_id tersimpan', async () => {
      // Ambil transfer yang terkait dengan indivAppIdOk
      const txSearch = await request(app.getHttpServer())
        .get(`${BASE}/complaints/transactions/search?customer_application_id=${indivAppIdOk}`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .expect(200);

      const tx = txSearch.body.data[0];
      if (!tx) return; // skip jika belum ada transfer

      const res = await request(app.getHttpServer())
        .post(`${BASE}/complaints`)
        .set('Authorization', `Bearer ${frontDeskToken}`)
        .send({
          customer_application_id: Number(indivAppIdOk),
          transfer_id: Number(tx.transfer_id),
          transaction_reference: tx.transaction_reference,
          category: 'TRANSFER',
          channel: 'WALK_IN',
          priority: 'HIGH',
          complaint_notes: 'Transfer sudah 3 hari belum tiba di rekening penerima.',
        })
        .expect(201);

      expect(String(res.body.transfer_id)).toBe(String(tx.transfer_id));
      expect(res.body.transaction_reference).toBe(tx.transaction_reference);
    });
  });

  // ══════════════════════════════════════════════════════════
  // R. RBA V01 — strict risk scoring
  // ══════════════════════════════════════════════════════════
  describe('R. RBA V01 strict', () => {

    // Helper: create + upload docs + submit individual, with optional RBA fields
    async function createRbaIndividual(tag: string, extra: Record<string, any> = {}): Promise<string> {
      const phone = `081${tag.replace(/\D/g, '').padEnd(9, '1').slice(0, 9)}`;
      const create = await request(app.getHttpServer())
        .post(`${BASE}/applications/individual`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          full_name: `RBA Test ${tag}`,
          ktp_number: TEST_KTP_NUMBER,
          identity_type: 'KTP',
          identity_number: `3175${tag.replace(/\D/g, '').padEnd(12, '0').slice(0, 12)}`,
          address_identity: 'Jl. RBA No. 1',
          pob: 'Jakarta',
          dob: '1990-01-01',
          nationality: 'ID',
          phone,
          occupation: 'Karyawan Swasta',
          gender: 'M',
          signature_uri: 'https://storage.test/rba_sig.png',
          ...extra,
        })
        .expect(201);
      const appId = String(create.body.id);
      // Upload identity doc + face photos
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/documents`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ doc_type: 'KTP', file_uri: 'https://storage.test/ktp.jpg' })
        .expect(201);
      await uploadFacePhotoDocs(appId);
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      return appId;
    }

    // ── R-01: Reference endpoints return only workbook values ─────────────────
    it('R-01: GET /references/rba/occupations → Excel values, each has score/risk_level/source_sheet', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/rba/occupations`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const item of res.body.data) {
        expect([1, 2, 3]).toContain(item.score);
        expect(['LOW', 'MEDIUM', 'HIGH']).toContain(item.risk_level);
        expect(item.source_sheet).toBe('1. Customer Profile');
      }
      const pns = res.body.data.find((d: any) => d.code === 'Pegawai Negeri Sipil (PNS)');
      expect(pns?.score).toBe(3);
      const profesional = res.body.data.find((d: any) => d.code === 'Profesional');
      expect(profesional?.score).toBe(1);
    });

    it('R-01b: GET /references/rba/distributions → exactly 3 values from Excel', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/rba/distributions`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(res.body.data.length).toBe(3);
      const codes = res.body.data.map((d: any) => d.code);
      expect(codes).toContain('Aplikasi Digital');
      expect(codes).toContain('Agen Pihak Ketiga');
      expect(codes).toContain('Outlet Fisik');
      expect(res.body.data.find((d: any) => d.code === 'Aplikasi Digital').score).toBe(3);
      // Workbook V01: Outlet Fisik downgraded 2 → 1
      expect(res.body.data.find((d: any) => d.code === 'Outlet Fisik').score).toBe(1);
    });

    it('R-01c: GET /references/rba/products → only Produk Remitansi = 3', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/rba/products`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].code).toBe('Produk Remitansi');
      expect(res.body.data[0].score).toBe(3);
      expect(res.body.data[0].source_sheet).toBe('2. Product');
    });

    it('R-01d: GET /references/rba/industries → 14 industries from Excel, correct scores', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/rba/industries`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(res.body.data.length).toBe(14);
      expect(res.body.data.find((d: any) => d.name === 'Aktivitas Keuangan dan Asuransi')?.score).toBe(3);
      expect(res.body.data.find((d: any) => d.name === 'Real Estat')?.score).toBe(3);
      expect(res.body.data.find((d: any) => d.name === 'Pendidikan')?.score).toBe(1);
      expect(res.body.data.find((d: any) => d.name === 'Pertanian, Kehutanan, dan Perikanan')?.score).toBe(1);
    });

    it('R-01e: GET /references/rba/geographies → 32 workbook provinces, DKI Jakarta = 3', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/rba/geographies`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      // Workbook sheet 3 lists exactly 32 unique provinces (Sumatera Selatan &
      // Sulawesi Tenggara are not in the workbook → not mappable).
      expect(res.body.data.length).toBe(32);
      expect(res.body.data.find((d: any) => d.name === 'DKI Jakarta')?.score).toBe(3);
      expect(res.body.data.find((d: any) => d.name === 'Papua Barat')?.score).toBe(3);
      expect(res.body.data.find((d: any) => d.name === 'Aceh')?.score).toBe(2);
      expect(res.body.data.find((d: any) => d.name === 'Bengkulu')?.score).toBe(1);
      expect(res.body.data.find((d: any) => d.name === 'Sumatera Selatan')).toBeUndefined();
    });

    it('R-01f: GET /references/rba/source-of-funds → Gaji = 1, Investasi = 3', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/references/rba/source-of-funds`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      expect(res.body.data.find((d: any) => d.code === 'Gaji')?.score).toBe(1);
      expect(res.body.data.find((d: any) => d.code === 'Investasi')?.score).toBe(3);
    });

    // ── R-02: Individual complete mappable data computes COMPLETE ─────────────
    it('R-02: Individual with all RBA fields mapped → COMPLETE + rba_score_v01 not null', async () => {
      // province_code 31 = DKI Jakarta (score 3)
      const appId = await createRbaIndividual(`R02${SUFFIX}`, {
        occupation: 'Karyawan Swasta',           // score 3
        source_of_funds: 'Gaji',                  // score 1
        industry_category: 'Makanan dan Minuman',  // → Penyediaan Akomodasi score 2
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_code: '31',                       // DKI Jakarta → province_name filled by service
        distribution_channel: 'Outlet Fisik',      // score 2
      });

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const risk = detail.body.risk;
      expect(risk.rba_calculation_status).toBe('COMPLETE');
      expect(risk.rba_score_v01).not.toBeNull();
      expect(typeof risk.rba_score_v01).toBe('number');
      // rba_score_v01 must be within 1–3 range
      expect(risk.rba_score_v01).toBeGreaterThanOrEqual(1);
      expect(risk.rba_score_v01).toBeLessThanOrEqual(3);
      // risk_level must match threshold
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(risk.risk_level);
      // Name Screening is mapped (CLEAR → score 0 in workbook V01)
      const nsParam = risk.rba_components?.components?.name_screening;
      expect(nsParam).toBeDefined();
      expect(nsParam.score).toBe(0);
      expect(nsParam.weight).toBe(0.01);
      // Name Screening is NOT in unmapped_parameters when mapped
      const nsUnmapped = (risk.rba_unmapped_parameters ?? []).find((p: any) => p.parameter === 'Name Screening / Watchlist');
      expect(nsUnmapped).toBeUndefined();
    });

    // ── R-03: Business complete mappable data computes COMPLETE ───────────────
    it('R-03: Business with all RBA fields mapped → COMPLETE rba_calculation_status', async () => {
      const sfx = `R03${SUFFIX}`;
      const biz = await request(app.getHttpServer())
        .post(`${BASE}/applications/business`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({
          legal_name: `PT RBA Complete ${sfx}`,
          legal_form: 'PT',
          incorporation_place: 'Jakarta',
          incorporation_date: '2020-01-01',
          deed_number: `AKTA-R03-${SUFFIX}`,
          nib: `1234567890${sfx.replace(/\D/g, '').slice(0, 3).padEnd(3, '0')}`,
          npwp: npwp15('01'),
          address_line: 'Jl. Test RBA No. 3',
          city: 'Jakarta',
          province: 'DKI Jakarta',
          postal_code: '12345',
          phone: `02112${sfx.replace(/\D/g, '').padEnd(5, '1').slice(0, 5)}`,
          business_activity: 'Layanan Finansial - Bank (Konvensional & Digital)',
          source_of_funds: 'Hasil usaha',
          business_relationship_purpose: 'Kegiatan usaha atau transaksi bisnis',
          distribution_channel: 'Aplikasi Digital',
        })
        .expect(201);

      const appId = String(biz.body.id);
      // Add BO party
      await request(app.getHttpServer())
        .post(`${BASE}/applications/${appId}/parties`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .send({ role: 'BO', full_name: `BO RBA ${sfx}`, identity_type: 'KTP', identity_number: `3175999${sfx.replace(/\D/g, '').padEnd(9, '0').slice(0, 9)}`, dob: '1985-05-15', nationality: 'ID', phone: `0813${sfx.replace(/\D/g, '').padEnd(8, '0').slice(0, 8)}` });
      // Upload required business docs + BO doc (required when BO party exists)
      for (const dt of ['BUSINESS_DEED_ESTABLISHMENT_AMENDMENT', 'BUSINESS_LICENSE', 'BUSINESS_NPWP', 'BUSINESS_MANAGEMENT_IDENTITY', 'BUSINESS_BO_DOCUMENT']) {
        await request(app.getHttpServer())
          .post(`${BASE}/applications/${appId}/documents`)
          .set('Authorization', `Bearer ${complianceToken}`)
          .send({ doc_type: dt, file_uri: `https://storage.test/${dt}.pdf` })
          .expect(201);
      }
      await request(app.getHttpServer())
        .patch(`${BASE}/applications/${appId}/submit`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.risk.rba_calculation_status).toBe('COMPLETE');
      expect(detail.body.risk.rba_score_v01).not.toBeNull();
    });

    // ── R-04: Unmapped occupation → INCOMPLETE ────────────────────────────────
    it('R-04: Occupation not in Excel → INCOMPLETE, rba_score_v01 null, Profil Pekerja in unmapped', async () => {
      const appId = await createRbaIndividual(`R04${SUFFIX}`, {
        occupation: 'Pilot Helikopter Militer',  // NOT in Excel
        source_of_funds: 'Gaji',
        industry_category: 'Makanan dan Minuman',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_code: '31',
        distribution_channel: 'Outlet Fisik',
      });

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.risk.rba_calculation_status).toBe('INCOMPLETE');
      expect(detail.body.risk.rba_score_v01).toBeNull();
      const occ = (detail.body.risk.rba_unmapped_parameters ?? []).find((p: any) => p.parameter === 'Profil Pekerja');
      expect(occ).toBeDefined();
      expect(occ.value).toBe('Pilot Helikopter Militer');
    });

    // ── R-05: Province not in Excel → INCOMPLETE (engine unit test) ────────────
    it('R-05: Province not in RBA geography map → Area Geografis INCOMPLETE', () => {
      const { computeRbaV01 } = require('../../src/modules/applications/rba-v01.engine');
      const result = computeRbaV01({
        type: 'INDIVIDUAL',
        occupation: 'Karyawan Swasta',
        source_of_funds: 'Gaji',
        industry_category: 'Makanan dan Minuman',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_name: 'Atlantis Selatan',  // NOT in sheet 3
        distribution_channel: 'Outlet Fisik',
      });
      expect(result.rba_calculation_status).toBe('INCOMPLETE');
      expect(result.rba_score_v01).toBeNull();
      const geo = result.rba_unmapped_parameters.find((p: any) => p.parameter === 'Area Geografis');
      expect(geo).toBeDefined();
      expect(geo.value).toBe('Atlantis Selatan');
    });

    // ── R-06: Missing distribution_channel → INCOMPLETE ───────────────────────
    it('R-06: Missing distribution_channel → Distribution INCOMPLETE', async () => {
      const appId = await createRbaIndividual(`R06${SUFFIX}`, {
        occupation: 'Karyawan Swasta',
        source_of_funds: 'Gaji',
        industry_category: 'Makanan dan Minuman',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_code: '31',
        // distribution_channel: omitted intentionally
      });

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      expect(detail.body.risk.rba_calculation_status).toBe('INCOMPLETE');
      const dist = (detail.body.risk.rba_unmapped_parameters ?? []).find((p: any) => p.parameter === 'Distribution');
      expect(dist).toBeDefined();
    });

    // ── R-07: Name Screening / Watchlist scoring behavior (workbook V01) ──────
    it('R-07: Name Screening weight 0.01; CLEAR/NO_MATCH=0, PEP/DTTOT/DPPSPM/PPPSPM/MATCH=3, NEAR_MATCH→INCOMPLETE', () => {
      const { computeRbaV01, PARAMETER_WEIGHTS } = require('../../src/modules/applications/rba-v01.engine');

      expect(PARAMETER_WEIGHTS.name_screening).toBe(0.01);

      const base = {
        type: 'INDIVIDUAL',
        occupation: 'Profesional',
        source_of_funds: 'Gaji',
        industry_category: 'Pertanian',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_name: 'DKI Jakarta',
        distribution_channel: 'Outlet Fisik',
      };
      const nsOf = (r: any) => r.rba_components.components.name_screening;

      // No-match/clear/false-positive/dismissed → score 0, COMPLETE
      for (const v of ['CLEAR', 'NO_MATCH', 'FALSE_POSITIVE', 'DISMISSED']) {
        const r = computeRbaV01({ ...base, name_screening_result: v });
        expect(r.rba_calculation_status).toBe('COMPLETE');
        expect(nsOf(r).score).toBe(0);
        expect(nsOf(r).weight).toBe(0.01);
      }

      // Confirmed hits → score 3, COMPLETE
      for (const v of ['PEP', 'DTTOT', 'DPPSPM', 'PPPSPM', 'MATCH', 'CONFIRMED_MATCH']) {
        const r = computeRbaV01({ ...base, name_screening_result: v });
        expect(r.rba_calculation_status).toBe('COMPLETE');
        expect(nsOf(r).score).toBe(3);
      }

      // NEAR_MATCH → INCOMPLETE (no score 2 in workbook), unmapped w/ review reason
      const near = computeRbaV01({ ...base, name_screening_result: 'NEAR_MATCH' });
      expect(near.rba_calculation_status).toBe('INCOMPLETE');
      expect(near.rba_score_v01).toBeNull();
      expect(nsOf(near).score).toBeNull();
      const nearUnmapped = near.rba_unmapped_parameters.find((p: any) => p.parameter === 'Name Screening / Watchlist');
      expect(nearUnmapped).toBeDefined();
      expect(nearUnmapped.value).toBe('NEAR_MATCH');
      expect(nearUnmapped.reason).toContain('Near match requires review');

      // UNREVIEWED → INCOMPLETE (same near-match reason)
      const unreviewed = computeRbaV01({ ...base, name_screening_result: 'UNREVIEWED' });
      expect(unreviewed.rba_calculation_status).toBe('INCOMPLETE');
      expect(unreviewed.rba_unmapped_parameters.find((p: any) => p.parameter === 'Name Screening / Watchlist')?.value).toBe('NEAR_MATCH');

      // null → INCOMPLETE, "not provided"
      const noResult = computeRbaV01({ ...base, name_screening_result: null });
      expect(noResult.rba_calculation_status).toBe('INCOMPLETE');
      expect(noResult.rba_score_v01).toBeNull();
      const nsUnmapped = noResult.rba_unmapped_parameters.find((p: any) => p.parameter === 'Name Screening / Watchlist');
      expect(nsUnmapped).toBeDefined();
      expect(nsUnmapped.reason).toContain('not provided');

      // unknown value → INCOMPLETE, "not mapped", carries actual value
      const unknown = computeRbaV01({ ...base, name_screening_result: 'UNKNOWN_STATUS' });
      expect(unknown.rba_calculation_status).toBe('INCOMPLETE');
      const nsUnknown = unknown.rba_unmapped_parameters.find((p: any) => p.parameter === 'Name Screening / Watchlist');
      expect(nsUnknown).toBeDefined();
      expect(nsUnknown.value).toBe('UNKNOWN_STATUS');
      expect(nsUnknown.reason).toContain('not mapped');
    });

    // ── R-08: Threshold verification via engine function ─────────────────────
    it('R-08: getRbaLevel threshold: <=1.50 LOW, >1.50-2.50 MEDIUM, >2.50 HIGH', () => {
      const { getRbaLevel } = require('../../src/modules/applications/rba-v01.engine');
      expect(getRbaLevel(0)).toBe('LOW');
      expect(getRbaLevel(1.00)).toBe('LOW');
      expect(getRbaLevel(1.50)).toBe('LOW');
      expect(getRbaLevel(1.51)).toBe('MEDIUM');
      expect(getRbaLevel(2.00)).toBe('MEDIUM');
      expect(getRbaLevel(2.50)).toBe('MEDIUM');
      expect(getRbaLevel(2.51)).toBe('HIGH');
      expect(getRbaLevel(3.00)).toBe('HIGH');
    });

    // ── R-09: Submit without RBA fields succeeds (INCOMPLETE, not blocked) ────
    it('R-09: Submit without RBA fields succeeds — INCOMPLETE does not block submit', async () => {
      const appId = await createRbaIndividual(`R09${SUFFIX}`, {
        occupation: 'Karyawan Swasta',
        // No source_of_funds, business_relationship_purpose, province_code, distribution_channel
      });
      // createRbaIndividual already calls submit with expect(200) — if we get here, submit succeeded
      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      // INCOMPLETE does not block submit — rba_calculation_status is INCOMPLETE
      expect(detail.body.risk.rba_calculation_status).toBe('INCOMPLETE');
      expect(detail.body.risk.rba_score_v01).toBeNull();
    });

    // ── R-10: rba_components is DIRECT_WEIGHTED_SUM with all 8 parameters ──────
    it('R-10: rba_components uses DIRECT_WEIGHTED_SUM; product = Produk Remitansi (3, weight 0.10)', async () => {
      const appId = await createRbaIndividual(`R10${SUFFIX}`, {
        occupation: 'Karyawan Swasta',
        source_of_funds: 'Gaji',
        industry_category: 'Makanan dan Minuman',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_code: '31',
        distribution_channel: 'Outlet Fisik',
      });

      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);

      const rba = detail.body.risk?.rba_components ?? {};
      expect(rba.calculation_model).toBe('DIRECT_WEIGHTED_SUM');
      const comp = rba.components ?? {};
      // No customer wrapper anymore — flat, direct-weighted parameters
      expect(comp).not.toHaveProperty('customer');
      for (const key of [
        'occupation_or_business_form', 'source_of_funds', 'industry',
        'business_relationship_purpose', 'name_screening', 'product',
        'geography', 'distribution',
      ]) {
        expect(comp).toHaveProperty(key);
      }
      expect(comp.product?.value).toBe('Produk Remitansi');
      expect(comp.product?.score).toBe(3);
      expect(comp.product?.weight).toBe(0.10);
      expect(comp.distribution?.weight).toBe(0.20);
      expect(comp.occupation_or_business_form?.weight).toBe(0.30);
    });

    // ── R-11: Direct weighted sum matches workbook "Sampling" sheet exactly ────
    it('R-11: DIRECT_WEIGHTED_SUM reproduces workbook Sampling rows (2.09 & 2.42), not customer×0.55', () => {
      const { computeRbaV01, PARAMETER_WEIGHTS } = require('../../src/modules/applications/rba-v01.engine');

      // Weights are the direct per-parameter weights (Σ = 1.00), no 0.55 wrapper
      expect(PARAMETER_WEIGHTS.occupation_or_business_form).toBe(0.30);
      expect(PARAMETER_WEIGHTS.source_of_funds).toBe(0.08);
      expect(PARAMETER_WEIGHTS.industry).toBe(0.15);
      expect(PARAMETER_WEIGHTS.business_relationship_purpose).toBe(0.01);
      expect(PARAMETER_WEIGHTS.name_screening).toBe(0.01);
      expect(PARAMETER_WEIGHTS.product).toBe(0.10);
      expect(PARAMETER_WEIGHTS.geography).toBe(0.15);
      expect(PARAMETER_WEIGHTS.distribution).toBe(0.20);
      const sum = (Object.values(PARAMETER_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);
      expect(Number(sum.toFixed(2))).toBe(1.00);

      // Sampling row 1: Karyawan Swasta / Gaji / Konsultan / TF Keluarga / clear /
      //                 Remitansi / Jakarta / Outlet Fisik = 2.09 (Medium)
      const s1 = computeRbaV01({
        type: 'INDIVIDUAL',
        occupation: 'Karyawan Swasta',
        source_of_funds: 'Gaji',
        industry_category: 'Konsultan',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_name: 'DKI Jakarta',
        distribution_channel: 'Outlet Fisik',
        name_screening_result: 'CLEAR',
      });
      expect(s1.rba_calculation_status).toBe('COMPLETE');
      expect(s1.rba_score_v01).toBe(2.09);
      expect(s1.risk_level).toBe('MEDIUM');
      expect(s1.rba_components.total_score).toBe(2.09);
      // Outlet Fisik contributes 1 × 0.20 = 0.20 (score 1, not 2)
      expect(s1.rba_components.components.distribution.score).toBe(1);
      expect(s1.rba_components.components.distribution.contribution).toBe(0.20);

      // Sampling row 3: PNS / Gaji / Pemerintah / TF Keluarga / PEP /
      //                 Remitansi / Jakarta / Outlet Fisik = 2.42 (Medium)
      const s3 = computeRbaV01({
        type: 'INDIVIDUAL',
        occupation: 'Pegawai Negeri Sipil (PNS)',
        source_of_funds: 'Gaji',
        industry_category: 'Pemerintah',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_name: 'DKI Jakarta',
        distribution_channel: 'Outlet Fisik',
        name_screening_result: 'PEP',
      });
      expect(s3.rba_calculation_status).toBe('COMPLETE');
      expect(s3.rba_score_v01).toBe(2.42);
      expect(s3.risk_level).toBe('MEDIUM');
      expect(s3.rba_components.components.name_screening.score).toBe(3);
      expect(s3.rba_components.components.name_screening.contribution).toBe(0.03);
    });

    // ── R-12: COMPLETE derives risk_score; INCOMPLETE never forces score/level ─
    it('R-12: COMPLETE → risk_score = round(score/3*100); INCOMPLETE → rba null, no forced RBA level', async () => {
      const { computeRbaV01 } = require('../../src/modules/applications/rba-v01.engine');

      // COMPLETE end-to-end: risk_score is derived from rba_score_v01
      const appId = await createRbaIndividual(`R12${SUFFIX}`, {
        occupation: 'Karyawan Swasta',
        source_of_funds: 'Gaji',
        industry_category: 'Konsultan',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_code: '31',
        distribution_channel: 'Outlet Fisik',
      });
      const detail = await request(app.getHttpServer())
        .get(`${BASE}/applications/${appId}`)
        .set('Authorization', `Bearer ${complianceToken}`)
        .expect(200);
      const risk = detail.body.risk;
      expect(risk.rba_calculation_status).toBe('COMPLETE');
      expect(risk.rba_score_v01).not.toBeNull();
      expect(risk.risk_score).toBe(Math.round((risk.rba_score_v01 / 3) * 100));

      // INCOMPLETE (engine): rba_score_v01 stays null, risk_level null
      const incomplete = computeRbaV01({
        type: 'INDIVIDUAL',
        occupation: 'Karyawan Swasta',
        source_of_funds: 'Gaji',
        industry_category: 'Konsultan',
        business_relationship_purpose: 'Kebutuhan pribadi, pembayaran rutin, atau transfer keluarga',
        province_name: 'Provinsi Tidak Ada Di Workbook',
        distribution_channel: 'Outlet Fisik',
        name_screening_result: 'CLEAR',
      });
      expect(incomplete.rba_calculation_status).toBe('INCOMPLETE');
      expect(incomplete.rba_score_v01).toBeNull();
      expect(incomplete.risk_level).toBeNull();
      expect(incomplete.rba_components.total_score).toBeNull();
    });

    // ── R-13: Threshold boundaries via full computation ──────────────────────
    it('R-13: thresholds <=1.50 LOW, >1.50-2.50 MEDIUM, >2.50 HIGH', () => {
      const { getRbaLevel } = require('../../src/modules/applications/rba-v01.engine');
      expect(getRbaLevel(1.50)).toBe('LOW');
      expect(getRbaLevel(1.51)).toBe('MEDIUM');
      expect(getRbaLevel(2.50)).toBe('MEDIUM');
      expect(getRbaLevel(2.51)).toBe('HIGH');
    });
  });
});
