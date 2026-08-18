import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { ApplicationsService } from '../../src/modules/applications/applications.service';
import { BusinessService } from '../../src/modules/business/business.service';
import { DataReviewsService } from '../../src/modules/data-reviews/data-reviews.service';

const BASE = '/api';
const PASSWORD = 'Test@123456';
const stamp = Date.now().toString();

type FinanceRole = 'FinanceStaff' | 'FinanceManager';

describe('CDD/KYC/KYB finance read-only RBAC', () => {
  let app: INestApplication;
  let pool: any;
  let sysAdminToken: string;
  let frontDeskToken: string;
  let individualAppId: string;
  let businessAppId: string;
  let businessId: string;
  const financeTokens = {} as Record<FinanceRole, string>;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function login(email: string, password: string): Promise<string> {
    const result = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email, password })
      .expect(201);
    return result.body.access_token;
  }

  async function createRole(role: FinanceRole | 'FrontDesk') {
    const email = `e2e.kyc.readonly.${role.toLowerCase()}.${stamp}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set(auth(sysAdminToken))
      .send({
        email,
        fullName: `E2E KYC Readonly ${role} ${stamp}`,
        role,
        password: PASSWORD,
      })
      .expect(201);
    return login(email, PASSWORD);
  }

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    pool = app.get('PG_POOL');

    sysAdminToken = await login('sysadmin@kesh.local', 'SystemAdmin@123');
    frontDeskToken = await createRole('FrontDesk');
    financeTokens.FinanceStaff = await createRole('FinanceStaff');
    financeTokens.FinanceManager = await createRole('FinanceManager');

    const nik = (`3175${stamp}`).padEnd(16, '0').slice(0, 16);
    const individual = await request(app.getHttpServer())
      .post(`${BASE}/applications/individual`)
      .set(auth(frontDeskToken))
      .send({
        full_name: `Readonly Individual ${stamp}`,
        ktp_number: nik,
        identity_type: 'KTP',
        identity_number: nik,
        pob: 'Jakarta',
        dob: '1990-01-01',
        nationality: 'Indonesia',
        phone: `0812${stamp.slice(-8)}`,
        occupation: 'Pegawai Swasta',
        gender: 'M',
        cif_relationship_type: 'OUR_CUSTOMER',
      })
      .expect(201);
    individualAppId = String(individual.body.id);

    await request(app.getHttpServer())
      .post(`${BASE}/applications/${individualAppId}/documents`)
      .set(auth(frontDeskToken))
      .send({ doc_type: 'INDIVIDUAL_KTP_PHOTO', file_uri: `https://storage.test/${stamp}.png` })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`${BASE}/applications/${individualAppId}/edd`)
      .set(auth(frontDeskToken))
      .send({ applicant_snapshot: { full_name: `Readonly Individual ${stamp}` } })
      .expect(200);

    const business = await request(app.getHttpServer())
      .post(`${BASE}/applications/business`)
      .set(auth(frontDeskToken))
      .send({
        legal_name: `PT Readonly ${stamp}`,
        legal_form: 'PT',
        incorporation_date: '2020-01-01',
        deed_establishment_number: `AKTA-${stamp}`,
        business_license_number: `NIB-${stamp}`,
        nib: `NIB-${stamp}`,
        npwp: stamp.padEnd(15, '0').slice(0, 15),
        address_line: 'Jl. Readonly No. 1',
        city: 'Jakarta',
        province: 'DKI Jakarta',
        postal_code: '12345',
        business_activity: 'Perdagangan Umum',
        phone: `021${stamp.slice(-8)}`,
      })
      .expect(201);
    businessAppId = String(business.body.id);
    const businessRow = await pool.query(
      'SELECT business_id FROM applications WHERE id=$1',
      [businessAppId],
    );
    businessId = String(businessRow.rows[0].business_id);

    await request(app.getHttpServer())
      .post(`${BASE}/applications/${businessAppId}/parties`)
      .set(auth(frontDeskToken))
      .send({
        role: 'BO',
        full_name: `Readonly BO ${stamp}`,
        identity_type: 'KTP',
        identity_number: (`3275${stamp}`).padEnd(16, '0').slice(0, 16),
        ownership_percentage: 50,
      })
      .expect(201);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  for (const role of ['FinanceStaff', 'FinanceManager'] as const) {
    it(`${role} can read application, documents, party/BO, EDD, risk, and screening`, async () => {
      const token = financeTokens[role];
      const reads = [
        `${BASE}/applications`,
        `${BASE}/applications/${individualAppId}`,
        `${BASE}/applications/${individualAppId}/documents`,
        `${BASE}/applications/${businessAppId}/parties`,
        `${BASE}/business/${businessId}/parties`,
        `${BASE}/applications/${individualAppId}/edd`,
        `${BASE}/applications/${individualAppId}/screening`,
      ];
      for (const path of reads) {
        await request(app.getHttpServer()).get(path).set(auth(token)).expect(200);
      }
    });

    it(`${role} receives 403 from every CDD/KYC/KYB mutation route`, async () => {
      const token = financeTokens[role];
      const mutations: Array<{
        method: 'post' | 'patch' | 'delete';
        path: string;
        body?: Record<string, unknown>;
        upload?: boolean;
      }> = [
        { method: 'post', path: `${BASE}/applications/individual`, body: {
          full_name: 'Forbidden Our Customer', identity_type: 'KTP', identity_number: '3175001234567890',
          cif_relationship_type: 'OUR_CUSTOMER',
        } },
        { method: 'post', path: `${BASE}/applications/individual`, body: {
          full_name: 'Forbidden WIC', identity_type: 'KTP', identity_number: '3175001234567890',
          cif_relationship_type: 'WIC',
        } },
        { method: 'post', path: `${BASE}/applications/business`, body: { legal_name: 'PT Forbidden', legal_form: 'PT' } },
        { method: 'patch', path: `${BASE}/applications/${individualAppId}`, body: { full_name: 'Forbidden edit' } },
        { method: 'patch', path: `${BASE}/applications/${businessAppId}/business`, body: { legal_name: 'PT Forbidden edit' } },
        { method: 'post', path: `${BASE}/applications/${individualAppId}/documents`, body: { doc_type: 'KTP', file_uri: 'x' } },
        { method: 'post', path: `${BASE}/applications/${individualAppId}/documents/upload`, upload: true },
        { method: 'delete', path: `${BASE}/applications/${individualAppId}/documents/1` },
        { method: 'post', path: `${BASE}/applications/${businessAppId}/parties`, body: {
          role: 'BO', full_name: 'Forbidden BO', identity_type: 'KTP', identity_number: '3175001234567890',
        } },
        { method: 'patch', path: `${BASE}/applications/${businessAppId}/parties/1`, body: { full_name: 'Forbidden BO edit' } },
        { method: 'delete', path: `${BASE}/applications/${businessAppId}/parties/1` },
        { method: 'post', path: `${BASE}/business/${businessId}/parties`, body: {
          role: 'BO', full_name: 'Forbidden generic BO', identity_type: 'KTP', identity_number: '3175001234567890',
        } },
        { method: 'post', path: `${BASE}/business/${businessId}/parties/link`, body: { person_id: 1, role: 'BO' } },
        { method: 'delete', path: `${BASE}/business/${businessId}/parties/1` },
        { method: 'patch', path: `${BASE}/applications/${individualAppId}/edd`, body: { applicant_snapshot: { name: 'Forbidden' } } },
        { method: 'patch', path: `${BASE}/applications/${individualAppId}/submit` },
        { method: 'patch', path: `${BASE}/applications/${individualAppId}/decision`, body: { decision: 'APPROVED' } },
        { method: 'post', path: `${BASE}/applications/${individualAppId}/rescreen-watchlist` },
        { method: 'post', path: `${BASE}/applications/${individualAppId}/data-review/initiate`, body: { review_type: 'MANUAL' } },
        { method: 'post', path: `${BASE}/applications/${individualAppId}/data-review/submit` },
        { method: 'post', path: `${BASE}/applications/${individualAppId}/data-review/decision`, body: { decision: 'APPROVED' } },
        { method: 'patch', path: `${BASE}/data-reviews/1/draft/person`, body: { full_name: 'Forbidden draft' } },
        { method: 'patch', path: `${BASE}/data-reviews/1/draft/business`, body: { legal_name: 'Forbidden draft' } },
        { method: 'post', path: `${BASE}/data-reviews/1/draft/parties`, body: { operation: 'ADD', role: 'BO' } },
        { method: 'post', path: `${BASE}/data-reviews/1/draft/documents`, body: { operation: 'DELETE', target_id: 1 } },
        { method: 'patch', path: `${BASE}/data-reviews/1/draft/edd`, body: { applicant_snapshot: { name: 'Forbidden' } } },
        { method: 'delete', path: `${BASE}/data-reviews/1/draft/changes/1` },
      ];

      for (const mutation of mutations) {
        let call = request(app.getHttpServer())[mutation.method](mutation.path).set(auth(token));
        if (mutation.upload) {
          call = call
            .field('doc_type', 'KTP')
            .attach('file', Buffer.from('forbidden'), { filename: 'forbidden.png', contentType: 'image/png' });
        } else if (mutation.body) {
          call = call.send(mutation.body);
        }
        await call.expect(403);
      }
    });

    it(`${role} is also blocked by service-level KYC guards`, async () => {
      const applications = app.get(ApplicationsService);
      const business = app.get(BusinessService);
      const dataReviews = app.get(DataReviewsService);

      await expect(applications.createIndividual({}, 1, 1, role)).rejects.toMatchObject({ status: 403 });
      await expect(business.addPartyWithNewPerson(Number(businessId), {}, role)).rejects.toMatchObject({ status: 403 });
      await expect(dataReviews.initiate(Number(individualAppId), { sub: 1, role }, {})).rejects.toMatchObject({ status: 403 });
    });
  }
});
