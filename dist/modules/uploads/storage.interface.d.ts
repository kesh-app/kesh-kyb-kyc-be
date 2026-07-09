export type UploadResult = {
    key: string;
    url: string;
    meta?: Record<string, any>;
};
export interface IStorage {
    uploadBuffer(buf: Buffer, mime: string, ext?: string, objectKey?: string): Promise<UploadResult>;
    deleteObject?(key: string): Promise<void>;
    getSignedUrl?(key: string, expiresSeconds?: number): Promise<string>;
}
