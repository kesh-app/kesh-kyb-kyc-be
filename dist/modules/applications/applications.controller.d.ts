import { ApplicationsService } from './applications.service';
import { CreateIndividualDto, CreateBusinessDto, AddDocumentDto } from './dto';
import { UploadsService } from '../uploads/uploads.service';
export declare class ApplicationsController {
    private readonly svc;
    private readonly uploads;
    constructor(svc: ApplicationsService, uploads: UploadsService);
    list(limit?: number, offset?: number): Promise<any[]>;
    createInd(req: any, dto: CreateIndividualDto): Promise<any>;
    createBiz(req: any, dto: CreateBusinessDto): Promise<any>;
    addDoc(appId: number, dto: AddDocumentDto): Promise<any>;
    listDocs(appId: number): Promise<any[]>;
    getDoc(appId: number, docId: number): Promise<any>;
    uploadDocument(appId: number, file: Express.Multer.File, docType?: string): Promise<any>;
    submit(appId: number, req: any): Promise<any>;
    deleteDoc(appId: number, docId: number): Promise<{
        ok: boolean;
        deleted_id: number;
    }>;
}
