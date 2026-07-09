import { OnModuleInit } from '@nestjs/common';
export declare class UploadsService implements OnModuleInit {
    private readonly logger;
    private readonly baseUrl;
    private readonly uploadDir;
    private provider;
    private obs;
    onModuleInit(): void;
    isObs(): boolean;
    uploadBuffer(buf: Buffer, mime: string, ext?: string, objectKey?: string): Promise<{
        key: string;
        url: string;
        meta?: any;
    }>;
    deleteObject(key: string): Promise<void>;
    /**
     * Returns a URL to access the stored file.
     * OBS: generates a short-lived signed URL (private bucket).
     * LOCAL: returns the public static URL.
     */
    getSignedUrl(key: string, expiresSeconds?: number): Promise<string>;
    private uploadLocal;
    private deleteLocal;
}
