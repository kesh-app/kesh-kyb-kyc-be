import { Injectable } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as fssync from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class UploadsService {
  private baseUrl = process.env.BASE_URL || 'http://localhost:4000';
  private uploadDir = process.env.UPLOAD_DIR || 'uploads';

  // Simpan file ke folder lokal dan kembalikan URL + object_key
  async uploadBuffer(buf: Buffer, mime: string, ext = ''): Promise<{ key: string; url: string; meta: any }> {
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

    // object_key relatif yang konsisten di semua driver (awali dengan "uploads/")
    const key = ['uploads', year, month, filename].join('/');

    // URL publik untuk disimpan di DB (dev/local served lewat /uploads)
    const url = `${this.baseUrl}/${key}`;

    return { key, url, meta: { mime } };
  }

  // Hapus file fisik berdasarkan object_key
  async deleteObject(key: string): Promise<void> {
    // key format: "uploads/YYYY/MM/uuid.ext"
    const localBase = this.uploadDir.replace(/\\/g, '/').replace(/^\.?\//, '');
    const rel = key.replace(/^uploads\//, `${localBase}/`);
    const filePath = path.resolve(process.cwd(), rel);
    try {
      await fs.unlink(filePath);
    } catch {
      // abaikan jika file tidak ada
    }
  }
}
