/**
 * Unit tests for ObsStorage.
 * Run with: npx jest src/modules/uploads/obs.storage.spec.ts --testEnvironment node
 */

jest.mock('esdk-obs-nodejs', () => {
  const mockPutObject = jest.fn((params: any, cb: any) =>
    cb(null, { CommonMsg: { Status: 200, Message: 'OK' } }),
  );
  const mockDeleteObject = jest.fn((params: any, cb: any) => cb(null, {}));
  const mockCreateSignedUrlSync = jest.fn(() => ({
    SignedUrl: 'https://obs.example.com/signed?token=abc',
    ActualSignedRequestHeaders: {},
  }));

  return jest.fn().mockImplementation(() => ({
    putObject: mockPutObject,
    deleteObject: mockDeleteObject,
    createSignedUrlSync: mockCreateSignedUrlSync,
  }));
});

import { ObsStorage } from './obs.storage';

/* eslint-disable @typescript-eslint/no-require-imports */
const ObsClientMock = require('esdk-obs-nodejs');

function makeInstance(): ObsStorage {
  process.env.OBS_BUCKET_NAME = 'test-bucket';
  process.env.HUAWEI_OBS_ACCESS_KEY_ID = 'test-ak';
  process.env.HUAWEI_OBS_SECRET_ACCESS_KEY = 'test-sk';
  process.env.OBS_ENDPOINT = 'https://obs.test.myhuaweicloud.com';
  return new ObsStorage();
}

describe('ObsStorage', () => {
  let storage: ObsStorage;
  let obsInstance: ReturnType<typeof ObsClientMock>;

  beforeEach(() => {
    ObsClientMock.mockClear();
    storage = makeInstance();
    obsInstance = ObsClientMock.mock.results[0].value;
  });

  describe('uploadBuffer', () => {
    it('uploads using provided objectKey and returns key === url', async () => {
      const key = 'kyc/1/KTP/1720000000000-ktp.jpg';
      const result = await storage.uploadBuffer(
        Buffer.from('fake-image'),
        'image/jpeg',
        'jpg',
        key,
      );
      expect(result.key).toBe(key);
      expect(result.url).toBe(key);
      expect(result.meta?.mime).toBe('image/jpeg');
      expect(obsInstance.putObject).toHaveBeenCalledWith(
        expect.objectContaining({ Bucket: 'test-bucket', Key: key }),
        expect.any(Function),
      );
    });

    it('auto-generates key when objectKey is omitted', async () => {
      const result = await storage.uploadBuffer(Buffer.from('data'), 'image/png', 'png');
      expect(result.key).toMatch(/^uploads\//);
      expect(result.key).toMatch(/\.png$/);
    });

    it('throws InternalServerError when OBS returns error callback', async () => {
      obsInstance.putObject.mockImplementationOnce((_p: any, cb: any) =>
        cb(new Error('network timeout'), null),
      );
      await expect(
        storage.uploadBuffer(Buffer.from('x'), 'image/jpeg', 'jpg', 'kyc/1/KTP/fail.jpg'),
      ).rejects.toThrow('OBS upload failed');
    });

    it('throws when OBS returns HTTP error status', async () => {
      obsInstance.putObject.mockImplementationOnce((_p: any, cb: any) =>
        cb(null, { CommonMsg: { Status: 403, Message: 'Access Denied' } }),
      );
      await expect(
        storage.uploadBuffer(Buffer.from('x'), 'image/jpeg', 'jpg', 'kyc/1/KTP/forbidden.jpg'),
      ).rejects.toThrow('HTTP 403');
    });

    it('does NOT create document record when upload fails (caller responsibility)', async () => {
      obsInstance.putObject.mockImplementationOnce((_p: any, cb: any) =>
        cb(new Error('disk full'), null),
      );
      // The upload rejects — caller should catch and not proceed to addDocument
      await expect(
        storage.uploadBuffer(Buffer.from('x'), 'application/pdf', 'pdf'),
      ).rejects.toThrow();
    });
  });

  describe('deleteObject', () => {
    it('resolves even when OBS returns an error (soft delete)', async () => {
      obsInstance.deleteObject.mockImplementationOnce((_p: any, cb: any) =>
        cb(new Error('not found'), null),
      );
      await expect(storage.deleteObject('kyc/1/KTP/old.jpg')).resolves.toBeUndefined();
    });

    it('calls OBS deleteObject with correct bucket and key', async () => {
      await storage.deleteObject('kyc/5/SIM/abc.jpg');
      expect(obsInstance.deleteObject).toHaveBeenCalledWith(
        { Bucket: 'test-bucket', Key: 'kyc/5/SIM/abc.jpg' },
        expect.any(Function),
      );
    });
  });

  describe('getSignedUrl', () => {
    it('returns the signed URL from OBS SDK', async () => {
      const url = await storage.getSignedUrl('kyc/1/KTP/doc.jpg', 300);
      expect(url).toBe('https://obs.example.com/signed?token=abc');
      expect(obsInstance.createSignedUrlSync).toHaveBeenCalledWith(
        expect.objectContaining({ Method: 'GET', Bucket: 'test-bucket', Key: 'kyc/1/KTP/doc.jpg', Expires: 300 }),
      );
    });

    it('throws when OBS does not return a SignedUrl', async () => {
      obsInstance.createSignedUrlSync.mockReturnValueOnce({ SignedUrl: '' });
      await expect(storage.getSignedUrl('kyc/1/KTP/doc.jpg')).rejects.toThrow(
        'Failed to generate OBS signed URL',
      );
    });
  });
});
