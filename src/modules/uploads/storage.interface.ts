export type UploadResult = {
  key: string;   // object key / relative path
  url: string;   // public URL for local; object key for OBS (private bucket)
  meta?: Record<string, any>;
};

export interface IStorage {
  uploadBuffer(buf: Buffer, mime: string, ext?: string, objectKey?: string): Promise<UploadResult>;
  deleteObject?(key: string): Promise<void>;
  getSignedUrl?(key: string, expiresSeconds?: number): Promise<string>;
}
