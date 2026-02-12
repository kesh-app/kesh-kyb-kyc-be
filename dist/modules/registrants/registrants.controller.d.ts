import { Pool } from 'pg';
export declare class RegistrantsController {
    private readonly pool;
    constructor(pool: Pool);
    list(type?: string, // INDIVIDUAL | BUSINESS
    q?: string, status?: string, // DRAFT|SUBMITTED|IN_REVIEW|ESCALATED|APPROVED|REJECTED
    limit?: string, offset?: string): Promise<{
        total: any;
        limit: number;
        offset: number;
        items: {
            application_id: any;
            type: any;
            status: any;
            created_at: any;
            risk_level: any;
            risk_score: any;
            display_name: any;
            email: any;
            phone: any;
            nib: any;
            npwp: any;
        }[];
    }>;
}
