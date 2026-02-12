import { ApplicationsService } from "./applications.service";
import { CreateIndividualDto, CreateBusinessDto, AddDocumentDto, CreatePartyDto } from "./dto";
import { UploadsService } from "../uploads/uploads.service";
export declare class ApplicationsController {
    private readonly svc;
    private readonly uploads;
    constructor(svc: ApplicationsService, uploads: UploadsService);
    list(limit?: number, offset?: number): Promise<any[]>;
    detail(appId: number): Promise<{
        application: any;
        documents: any[];
        parties: any[];
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
    getDoc(appId: number, docId: number): Promise<any>;
    uploadDocument(appId: number, file: Express.Multer.File, docType?: string): Promise<any>;
    submit(appId: number, req: any): Promise<{
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
    deleteDoc(appId: number, docId: number): Promise<{
        ok: boolean;
        deleted_id: number;
    }>;
}
