export declare const INTERNAL_ROLES: readonly ["SystemAdmin", "BranchAdmin", "FrontDesk", "ComplianceLead", "Auditor", "FinanceStaff", "FinanceManager", "Director"];
export type InternalRole = (typeof INTERNAL_ROLES)[number];
export declare class CreateAdminUserDto {
    email: string;
    fullName: string;
    role: InternalRole;
    branchId?: number;
    password: string;
}
export declare class UpdateAdminUserDto {
    role?: InternalRole;
    isActive?: boolean;
    branchId?: number | null;
}
