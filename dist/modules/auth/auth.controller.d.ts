import { AuthService } from './auth.service';
export declare class AuthController {
    private auth;
    constructor(auth: AuthService);
    login(body: {
        email: string;
        password: string;
    }): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: "SystemAdmin" | "BranchAdmin" | "FrontDesk" | "ComplianceLead" | "Auditor" | "FinanceStaff" | "FinanceManager";
        };
    }>;
    me(req: any): Promise<{
        id: number | undefined;
        name: string | undefined;
        email: string | undefined;
        role: "SystemAdmin" | "BranchAdmin" | "FrontDesk" | "ComplianceLead" | "Auditor" | "FinanceStaff" | "FinanceManager" | undefined;
        last_login_at: Date | null | undefined;
    }>;
}
