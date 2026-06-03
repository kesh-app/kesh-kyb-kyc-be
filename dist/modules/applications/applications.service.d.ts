import { Pool } from "pg";
export declare class ApplicationsService {
    private readonly pool;
    constructor(pool: Pool);
    private recomputeAutoBump;
    createIndividual(dto: any, userId: number, branchId?: number): Promise<any>;
    isOnWatchlist(fullName: string, aliases: string[], identityNumber: string): Promise<boolean>;
    createBusiness(dto: any, userId: number, branchId?: number): Promise<any>;
    addDocument(appId: number, dto: {
        doc_type: string;
        file_uri: string;
        extracted_json?: any;
    }): Promise<any>;
    getDetail(appId: number): Promise<{
        application: any;
        documents: any[];
        parties: any[];
    }>;
    validateBeforeSubmit(appId: number): Promise<{
        ok: boolean;
    }>;
    /** Jalankan screening terhadap subject aplikasi + compute risk, simpan ke screening_results & application_risk */
    screenAndComputeRisk(appId: number): Promise<{
        risk_score: number;
        risk_level: string;
        factors: {
            hits: {
                pep: number;
                dttot: number;
                pppspm: number;
            };
            docPenalty: number;
            threshold: number;
            weights: {
                PEP: number;
                DTTOT: number;
                PPPSPM: number;
                DOC_MISSING: number;
            };
        };
    }>;
    listParties(appId: number): Promise<any[]>;
    addParty(appId: number, dto: any): Promise<any>;
    deleteParty(appId: number, partyId: number): Promise<{
        ok: boolean;
    }>;
    submit(appId: number, reviewerId: number): Promise<{
        id: number;
        status: string;
        risk: {
            risk_score: number;
            risk_level: string;
            factors: {
                hits: {
                    pep: number;
                    dttot: number;
                    pppspm: number;
                };
                docPenalty: number;
                threshold: number;
                weights: {
                    PEP: number;
                    DTTOT: number;
                    PPPSPM: number;
                    DOC_MISSING: number;
                };
            };
        };
    }>;
    list(limit?: number, offset?: number): Promise<any[]>;
    listDocuments(appId: number): Promise<any[]>;
    getScreening(appId: number): Promise<{
        results: any[];
        risk: any;
    }>;
    reviewScreeningResult(appId: number, resultId: number, status: "CONFIRMED" | "FALSE_POSITIVE" | "DISMISSED", notes: string | null, reviewerId: number): Promise<{
        ok: boolean;
    }>;
    overrideRisk(appId: number, level: "LOW" | "MEDIUM" | "HIGH", reason: string, reviewerId: number): Promise<{
        ok: boolean;
    }>;
    listWithRisk(limit?: number, offset?: number): Promise<any[]>;
    getDocument(appId: number, docId: number): Promise<any>;
    deleteDocument(appId: number, docId: number): Promise<any>;
    decide(appId: number, decision: "APPROVED" | "REJECTED", reason: string | null, reviewerId: number): Promise<any>;
}
