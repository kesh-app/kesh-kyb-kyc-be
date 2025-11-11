export declare class UploadsService {
    private baseUrl;
    private uploadDir;
    uploadBuffer(buf: Buffer, mime: string, ext?: string): Promise<{
        key: string;
        url: string;
        meta: any;
    }>;
    deleteObject(key: string): Promise<void>;
}
