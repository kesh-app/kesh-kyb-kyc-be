export type UploadResult = {
  key: string;   // object key / relative path
  url: string;   // public URL (disimpan ke DB)
  meta?: Record<string, any>;
};

export interface IStorage {
  uploadBuffer(buf: Buffer, mime: string, ext?: string): Promise<UploadResult>;
  deleteObject?(key: string): Promise<void>; // optional per driver
}