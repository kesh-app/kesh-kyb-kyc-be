import { Pool } from 'pg';
export declare class HealthController {
    private readonly pool;
    constructor(pool: Pool);
    health(): Promise<{
        ok: boolean;
        db: boolean;
    }>;
}
