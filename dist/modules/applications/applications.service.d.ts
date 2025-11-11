import { Pool } from 'pg';
export declare class ApplicationsService {
    private readonly pool;
    constructor(pool: Pool);
    createIndividual(dto: any, userId: number, branchId?: number): Promise<any>;
    createBusiness(dto: any, userId: number, branchId?: number): Promise<any>;
    addDocument(appId: number, dto: {
        doc_type: string;
        file_uri: string;
        extracted_json?: any;
    }): Promise<any>;
    submit(appId: number, reviewerId: number): Promise<any>;
    list(limit?: number, offset?: number): Promise<any[]>;
    listDocuments(appId: number): Promise<any[]>;
    getDocument(appId: number, docId: number): Promise<any>;
    deleteDocument(appId: number, docId: number): Promise<any>;
}
