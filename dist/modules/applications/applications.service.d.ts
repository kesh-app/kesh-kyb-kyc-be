import { Pool } from "pg";
export interface RiskFactor {
    code: string;
    label: string;
    score: number;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
    source: string;
    details?: string;
}
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
        person: any;
        business: any;
        documents: any[];
        parties: any[];
        risk: any;
        edd: {
            edd_required: any;
            edd_completed: any;
        };
    }>;
    validateBeforeSubmit(appId: number): Promise<{
        ok: boolean;
    }>;
    /**
     * Internal Preliminary Risk Scoring — RBA v2.
     * Bukan formula resmi BI. Digunakan sebagai dasar review compliance internal.
     */
    screenAndComputeRisk(appId: number): Promise<{
        risk_score: number;
        risk_level: string;
        factors: {
            version: string;
            hits: any;
            score_breakdown: {
                code: string;
                score: number;
            }[];
            threshold: number;
        };
        risk_factors: RiskFactor[];
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
                version: string;
                hits: any;
                score_breakdown: {
                    code: string;
                    score: number;
                }[];
                threshold: number;
            };
            risk_factors: RiskFactor[];
        };
    }>;
    private initEddForHighRisk;
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
    getEdd(appId: number): Promise<any>;
    saveEdd(appId: number, body: any, userId: number): Promise<any>;
    private validateEddCompletion;
    decide(appId: number, decision: "APPROVED" | "REJECTED", reason: string | null, reviewerId: number): Promise<any>;
}
