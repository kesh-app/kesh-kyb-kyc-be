import { TransfersService } from "./transfers.service";
import { CreateTransferDto, DecideTransferDto, SetTransferResultDto, UpdateTransferDto } from "./dto";
export declare class TransfersController {
    private readonly svc;
    constructor(svc: TransfersService);
    create(req: any, dto: CreateTransferDto): Promise<any>;
    updateDraft(req: any, id: number, dto: UpdateTransferDto): Promise<any>;
    submit(req: any, id: number): Promise<any>;
    decide(req: any, id: number, dto: DecideTransferDto): Promise<any>;
    setResult(req: any, id: number, dto: SetTransferResultDto): Promise<any>;
    list(req: any, status?: string): Promise<any[]>;
    snapPreview(req: any, id: number): Promise<Record<string, any>>;
    getById(req: any, id: number): Promise<any>;
}
