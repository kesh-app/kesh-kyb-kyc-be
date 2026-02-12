import { Pool } from 'pg';
export declare class BusinessService {
    private readonly pool;
    constructor(pool: Pool);
    ensureBusiness(businessId: number): Promise<void>;
    createPerson(dto: any): Promise<number>;
    addPartyWithNewPerson(businessId: number, dto: any): Promise<any>;
    linkExistingPerson(businessId: number, personId: number, role: string): Promise<any>;
    listParties(businessId: number): Promise<any[]>;
    removeParty(businessId: number, partyId: number): Promise<{
        ok: boolean;
    }>;
}
