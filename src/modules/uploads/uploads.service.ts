import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ObsStorage } from './obs.storage';

const OBS_REQUIRED_VARS = [
  'OBS_BUCKET_NAME',
  'OBS_REGION',
  'OBS_ENDPOINT',
  'HUAWEI_OBS_ACCESS_KEY_ID',
  'HUAWEI_OBS_SECRET_ACCESS_KEY',
];

@Injectable()
export class UploadsService implements OnModuleInit {
  private readonly logger = new Logger(UploadsService.name);
  private readonly baseUrl = process.env.BASE_URL || 'http://localhost:4000';
  private readonly uploadDir = process.env.UPLOAD_DIR || 'uploads';
  private provider = (process.env.STORAGE_PROVIDER || 'LOCAL').toUpperCase();
  private obs: ObsStorage | null = null;

  onModuleInit() {
    if (this.provider === 'HUAWEI_OBS') {
      const missing = OBS_REQUIRED_VARS.filter((k) => !process.env[k]);
      if (missing.length) {
        this.logger.error(
          `STORAGE_PROVIDER=HUAWEI_OBS but missing env vars: ${missing.join(', ')}. ` +
            `Falling back to LOCAL — files will NOT be stored in OBS.`,
        );
        this.provider = 'LOCAL';
      } else {
        this.obs = new ObsStorage();
        this.logger.log(
          `Storage: Huawei OBS — bucket=${process.env.OBS_BUCKET_NAME} endpoint=${process.env.OBS_ENDPOINT}`,
        );
      }
    } else {
      this.logger.log(`Storage: LOCAL — dir=${path.resolve(this.uploadDir)}`);
    }
  }

  isObs(): boolean {
    return this.provider === 'HUAWEI_OBS' && this.obs !== null;
  }

  async uploadBuffer(
    buf: Buffer,
    mime: string,
    ext = '',
    objectKey?: string,
  ): Promise<{ key: string; url: string; meta?: any }> {
    if (this.isObs()) {
      return this.obs!.uploadBuffer(buf, mime, ext, objectKey);
    }
    return this.uploadLocal(buf, mime, ext);
  }

  async deleteObject(key: string): Promise<void> {
    if (this.isObs()) {
      return this.obs!.deleteObject(key);
    }
    return this.deleteLocal(key);
  }

  /**
   * Returns a URL to access the stored file.
   * OBS: generates a short-lived signed URL (private bucket).
   * LOCAL: returns the public static URL.
   */
  async getSignedUrl(key: string, expiresSeconds = 300): Promise<string> {
    if (this.isObs()) {
      return this.obs!.getSignedUrl(key, expiresSeconds);
    }
    if (key.startsWith('http://') || key.startsWith('https://')) return key;
    return `${this.baseUrl}/${key}`;
  }

  private async uploadLocal(
    buf: Buffer,
    mime: string,
    ext = '',
  ): Promise<{ key: string; url: string; meta: any }> {
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');

    const dir = path.join(this.uploadDir, year, month);
    if (!fssync.existsSync(dir)) {
      await fs.mkdir(dir, { recursive: true });
    }

    const filename = `${randomUUID()}${ext ? '.' + ext : ''}`;
    const filePath = path.join(dir, filename);
    await fs.writeFile(filePath, buf);

    const key = ['uploads', year, month, filename].join('/');
    const url = `${this.baseUrl}/${key}`;
    return { key, url, meta: { mime } };
  }

  private async deleteLocal(key: string): Promise<void> {
    const localBase = this.uploadDir.replace(/\\/g, '/').replace(/^\.?\//, '');
    const rel = key.replace(/^uploads\//, `${localBase}/`);
    const filePath = path.resolve(process.cwd(), rel);
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore if file doesn't exist
    }
  }
}
