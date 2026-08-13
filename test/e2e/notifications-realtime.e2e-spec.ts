/**
 * E2E — realtime notifications (Socket.IO) + REST fallback.
 *
 * Self-contained on purpose (own app instance, own fixtures) instead of
 * living inside app.e2e-spec.ts: a WebSocket client needs the app actually
 * listening on a real port (app.listen(0)), unlike the rest of the suite
 * which only calls app.init() and lets supertest bind ephemeral ports.
 *
 * Prasyarat sama seperti app.e2e-spec.ts: npm run db:migrate && npm run db:seed.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request = require('supertest');
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';

const BASE = '/api';
const SUFFIX = Date.now().toString().slice(-7);

function waitForEvent<T = any>(socket: Socket, event: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('Notifications — realtime (Socket.IO) + REST', () => {
  let app: INestApplication;
  let baseUrl: string;
  let complianceToken: string;
  let opSupervisorToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    // Socket.IO needs a real listening port — app.init() alone doesn't bind one.
    await app.listen(0);
    const address = app.getHttpServer().address() as import('net').AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    const loginComp = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: 'admin@example.com', password: 'Admin123!' });
    complianceToken = loginComp.body.access_token;

    const loginSys = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: 'sysadmin@kesh.local', password: 'SystemAdmin@123' });
    const sysAdminToken = loginSys.body.access_token;

    const opEmail = `opsup${SUFFIX}@test.local`;
    await request(app.getHttpServer())
      .post(`${BASE}/users/admins`)
      .set('Authorization', `Bearer ${sysAdminToken}`)
      .send({
        email: opEmail,
        fullName: `Test OpSupervisor ${SUFFIX}`,
        role: 'OperationSupervisor',
        password: 'Test@123456',
      });
    const loginOp = await request(app.getHttpServer())
      .post(`${BASE}/auth/login`)
      .send({ email: opEmail, password: 'Test@123456' });
    opSupervisorToken = loginOp.body.access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  /** Individual application whose default risk profile is LOW/MEDIUM — lands on
   * SUBMITTED (OperationSupervisor's queue), not IN_REVIEW (HIGH/ComplianceLead). */
  async function createAndSubmitIndividual(tag: string): Promise<string> {
    const create = await request(app.getHttpServer())
      .post(`${BASE}/applications/individual`)
      .set('Authorization', `Bearer ${complianceToken}`)
      .send({
        full_name: `Notif Realtime ${tag} ${SUFFIX}`,
        ktp_number: `3175${SUFFIX}${tag}`.padEnd(16, '0').slice(0, 16),
        identity_type: 'KTP',
        identity_number: `3175${tag}${SUFFIX}`,
        address_identity: 'Jl. Realtime No. 1',
        pob: 'Jakarta',
        dob: '1990-01-01',
        nationality: 'ID',
        phone: `0813${tag}${SUFFIX}`,
        occupation: 'Karyawan Swasta',
        gender: 'M',
        signature_uri: 'https://storage.test/notif_realtime_sig.png',
      })
      .expect(201);
    const appId = String(create.body.id);

    await request(app.getHttpServer())
      .post(`${BASE}/applications/${appId}/documents`)
      .set('Authorization', `Bearer ${complianceToken}`)
      .send({ doc_type: 'KTP', file_uri: 'https://storage.test/notif_realtime_ktp.jpg' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/applications/${appId}/documents`)
      .set('Authorization', `Bearer ${complianceToken}`)
      .send({ doc_type: 'INDIVIDUAL_FACE_PHOTO', file_uri: 'https://storage.test/notif_realtime_face.jpg' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${BASE}/applications/${appId}/documents`)
      .set('Authorization', `Bearer ${complianceToken}`)
      .send({ doc_type: 'INDIVIDUAL_FACE_WITH_KTP_PHOTO', file_uri: 'https://storage.test/notif_realtime_face_ktp.jpg' })
      .expect(201);

    const submitted = await request(app.getHttpServer())
      .patch(`${BASE}/applications/${appId}/submit`)
      .set('Authorization', `Bearer ${complianceToken}`)
      .expect(200);
    expect(submitted.body.status).toBe('SUBMITTED');

    return appId;
  }

  it('connects, joins role room, and receives a live event when an application needs OperationSupervisor review', async () => {
    const socket = io(`${baseUrl}/notifications`, {
      auth: { token: opSupervisorToken },
      transports: ['websocket'],
      forceNew: true,
    });

    try {
      await waitForEvent(socket, 'connect');

      // The pushed payload is the actual DB row (id/created_at/etc — same shape
      // list()/count() return over REST), not a partial echo of the input DTO —
      // every recipient needs its own row id to mark its own copy read.
      const notificationPromise = waitForEvent<{
        id: number;
        type: string;
        object_type: string;
        object_id: string;
        title: string;
        link: string;
        created_at: string;
      }>(socket, 'notification');

      const appId = await createAndSubmitIndividual('1');
      const payload = await notificationPromise;

      expect(payload.id).toBeDefined();
      expect(payload.created_at).toBeDefined();
      expect(payload.type).toBe('ACTION_REQUIRED');
      expect(payload.object_type).toBe('application');
      expect(String(payload.object_id)).toBe(appId);
      expect(payload.link).toBe(`/users/${appId}`);
    } finally {
      socket.disconnect();
    }
  });

  it('rejects a connection with no/invalid token', async () => {
    // Default transports (polling → upgrade), not pinned to raw websocket-only:
    // a server-initiated disconnect() right after connect needs the polling
    // handshake to reliably propagate the close back to this client.
    const socket = io(`${baseUrl}/notifications`, {
      auth: { token: 'not-a-real-token' },
      forceNew: true,
    });

    try {
      // Server-side verification is fast enough that "disconnect" can arrive
      // essentially back-to-back with "connect" — sometimes before this code
      // even resumes from awaiting "connect". Register the disconnect listener
      // FIRST so there is no window to miss it, then await both.
      const disconnected = waitForEvent(socket, 'disconnect');
      await waitForEvent(socket, 'connect');
      await disconnected;
      expect(socket.connected).toBe(false);
    } finally {
      socket.disconnect();
    }
  });

  it('REST fallback: GET /notifications and /notifications/count reflect the same item', async () => {
    const appId = await createAndSubmitIndividual('2');

    const countRes = await request(app.getHttpServer())
      .get(`${BASE}/notifications/count`)
      .set('Authorization', `Bearer ${opSupervisorToken}`)
      .expect(200);
    expect(countRes.body.count).toBeGreaterThan(0);

    const listRes = await request(app.getHttpServer())
      .get(`${BASE}/notifications`)
      .set('Authorization', `Bearer ${opSupervisorToken}`)
      .expect(200);
    const match = listRes.body.find(
      (n: any) => n.object_type === 'application' && String(n.object_id) === appId,
    );
    expect(match).toBeDefined();
    expect(match.read_at).toBeNull();

    const readRes = await request(app.getHttpServer())
      .post(`${BASE}/notifications/${match.id}/read`)
      .set('Authorization', `Bearer ${opSupervisorToken}`)
      .expect(201);
    expect(readRes.body.read_at).not.toBeNull();

    const countAfter = await request(app.getHttpServer())
      .get(`${BASE}/notifications/count`)
      .set('Authorization', `Bearer ${opSupervisorToken}`)
      .expect(200);
    expect(countAfter.body.count).toBeLessThan(countRes.body.count);
  });
});
