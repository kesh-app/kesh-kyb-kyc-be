import { ApplicationsService } from "./applications.service";
import { CreateIndividualDto, CreateBusinessDto, AddDocumentDto, CreatePartyDto, DecisionDto, ListApplicationsQueryDto } from "./dto";
import { UploadsService } from "../uploads/uploads.service";
export declare class ApplicationsController {
    private readonly svc;
    private readonly uploads;
    constructor(svc: ApplicationsService, uploads: UploadsService);
    list(query: ListApplicationsQueryDto): Promise<{
        data: any[];
        total: number;
        page: number;
        limit: number;
    }>;
    detail(appId: number): Promise<{
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
    /** (Opsional) quick pre-check tanpa submit */
    precheck(appId: number): Promise<{
        ok: boolean;
    }>;
    createInd(req: any, dto: CreateIndividualDto): Promise<any>;
    createBiz(req: any, dto: CreateBusinessDto): Promise<any>;
    addDoc(appId: number, dto: AddDocumentDto): Promise<any>;
    listParties(appId: number): Promise<any[]>;
    addParty(appId: number, dto: CreatePartyDto): Promise<any>;
    removeParty(appId: number, partyId: number): Promise<{
        ok: boolean;
    }>;
    screening(appId: number): Promise<{
        results: any[];
        risk: any;
    }>;
    listDocs(appId: number): Promise<any[]>;
    getDocumentUrl(appId: number, docId: number): Promise<{
        signed_url: string;
        expires_in: number;
    }>;
    getDoc(appId: number, docId: number): Promise<any>;
    uploadDocument(appId: number, file: Express.Multer.File, docType?: string): Promise<any>;
    getEdd(appId: number): Promise<any>;
    saveEdd(appId: number, body: any, req: any): Promise<any>;
    submit(appId: number, req: any): Promise<{
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
            risk_factors: import("./applications.service").RiskFactor[];
        };
    }>;
    decide(appId: number, dto: DecisionDto, req: any): Promise<any>;
    deleteDoc(appId: number, docId: number): Promise<{
        ok: boolean;
        deleted_id: number;
    }>;
}
