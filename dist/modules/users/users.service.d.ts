import { Pool } from "pg";
import { CreateAdminUserDto, UpdateAdminUserDto } from "./admin.dto";
export type UserRow = {
    id: number;
    name: string;
    email: string;
    password_hash: string;
    role: "BranchAdmin" | "FrontDesk" | "ComplianceLead" | "Auditor" | "FinanceStaff" | "FinanceManager" | "SystemAdmin";
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
    listAdmins(): Promise<any[]>;
    createAdmin(dto: CreateAdminUserDto, actorId: number): Promise<any>;
    updateAdmin(id: number, dto: UpdateAdminUserDto, actorId: number): Promise<any>;
    getUserByApplicationId(applicationId: number): Promise<any>;
    /** List semua user individu (opsional pagination) */
    listIndividuals(limit?: number, offset?: number): Promise<any[]>;
}
