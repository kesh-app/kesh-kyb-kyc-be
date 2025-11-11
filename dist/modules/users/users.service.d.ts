import { Pool } from 'pg';
export type UserRow = {
    id: number;
    name: string;
    email: string;
    password_hash: string;
    role: 'BranchAdmin' | 'ComplianceReviewer' | 'ComplianceLead' | 'Auditor';
    branch_id: number | null;
    last_login_at: Date | null;
    created_at: Date;
};
export declare class UsersService {
    private readonly pool;
    constructor(pool: Pool);
    findByEmail(email: string): Promise<UserRow | null>;
    findById(id: number): Promise<UserRow | null>;
    verifyPassword(plain: string, hash: string): Promise<boolean>;
    touchLastLogin(userId: number): Promise<void>;
}
