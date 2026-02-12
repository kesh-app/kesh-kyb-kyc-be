import { Pool } from 'pg';
export declare class DashboardController {
    private readonly pool;
    constructor(pool: Pool);
    summary(limit?: string): Promise<{
        totals: {
            total: any;
            status: any;
            risk: any;
        };
        recent: any[];
    }>;
    submissions(limit?: string): Promise<any[]>;
}
