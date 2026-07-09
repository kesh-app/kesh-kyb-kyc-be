import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { UploadResult } from './storage.interface';

/* eslint-disable @typescript-eslint/no-require-imports */
const ObsClient = require('esdk-obs-nodejs');

export class ObsStorage {
  private readonly logger = new Logger(ObsStorage.name);
  private readonly client: any;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.OBS_BUCKET_NAME!;
    this.client = new ObsClient({
      access_key_id: process.env.HUAWEI_OBS_ACCESS_KEY_ID,
      secret_access_key: process.env.HUAWEI_OBS_SECRET_ACCESS_KEY,
      server: process.env.OBS_ENDPOINT,
    });
  }

  async uploadBuffer(
    buf: Buffer,
    mime: string,
    ext = '',
    objectKey?: string,
  ): Promise<UploadResult> {
    const key = objectKey ?? `uploads/${Date.now()}-${randomUUID()}${ext ? '.' + ext : ''}`;
    await this.putObject(key, buf, mime);
    // url === key for OBS (private bucket — access via signed URL only)
    return { key, url: key, meta: { mime } };
  }

  async deleteObject(key: string): Promise<void> {
    return new Promise<void>((resolve) => {
      this.client.deleteObject({ Bucket: this.bucket, Key: key }, (err: any) => {
        if (err) {
          this.logger.warn(`OBS deleteObject failed key=${key}: ${JSON.stringify(err)}`);
        }
        resolve();
      });
    });
  }

  async getSignedUrl(key: string, expiresSeconds = 300): Promise<string> {
    const result = this.client.createSignedUrlSync({
      Method: 'GET',
      Bucket: this.bucket,
      Key: key,
      Expires: expiresSeconds,
    });
    if (!result?.SignedUrl) {
      throw new Error(`Failed to generate OBS signed URL for key=${key}`);
    }
    return result.SignedUrl as string;
  }

  private putObject(key: string, buf: Buffer, mime: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.client.putObject(
        { Bucket: this.bucket, Key: key, Body: buf, ContentType: mime },
        (err: any, result: any) => {
          if (err) {
            this.logger.error(`OBS putObject error key=${key}: ${JSON.stringify(err)}`);
            return reject(new Error(`OBS upload failed: ${err.message ?? JSON.stringify(err)}`));
          }
          if (result?.CommonMsg?.Status >= 300) {
            this.logger.error(
              `OBS putObject HTTP error key=${key} status=${result.CommonMsg.Status}`,
            );
            return reject(
              new Error(`OBS upload error: HTTP ${result.CommonMsg.Status} ${result.CommonMsg.Message}`),
            );
          }
          resolve();
        },
      );
    });
  }
}
