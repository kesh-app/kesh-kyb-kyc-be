import { Pool } from "pg";
import { CreateTransferDto, DecideTransferDto, SetTransferResultDto, UpdateTransferDto } from "./dto";
type AuthedUser = {
    sub?: number | string;
    id?: number | string;
    role: string;
};
export declare class TransfersService {
    private readonly pool;
    constructor(pool: Pool);
    private audit;
    /**
     * Pastikan partner_reference_no unik. Jika user mengirim sendiri → validasi
     * tidak duplikat. Jika kosong → generate server-side dengan retry anti-tabrakan.
     */
    private resolvePartnerReferenceNo;
    create(user: AuthedUser, dto: CreateTransferDto, ip?: string): Promise<any>;
    updateDraft(id: number, user: AuthedUser, dto: UpdateTransferDto, ip?: string): Promise<any>;
    submit(id: number, user: AuthedUser, ip?: string): Promise<any>;
    decide(id: number, user: AuthedUser, dto: DecideTransferDto, ip?: string): Promise<any>;
    setResult(id: number, user: AuthedUser, dto: SetTransferResultDto, ip?: string): Promise<any>;
    list(user: AuthedUser, status?: string): Promise<any[]>;
    getById(id: number, user: AuthedUser): Promise<any>;
    snapPreview(id: number, user: AuthedUser): Promise<Record<string, any>>;
}
export {};
