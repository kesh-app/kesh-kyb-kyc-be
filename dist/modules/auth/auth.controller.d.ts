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
            role: "BranchAdmin" | "ComplianceReviewer" | "ComplianceLead" | "Auditor";
        };
    }>;
    me(req: any): Promise<{
        id: number | undefined;
        name: string | undefined;
        email: string | undefined;
        role: "BranchAdmin" | "ComplianceReviewer" | "ComplianceLead" | "Auditor" | undefined;
        last_login_at: Date | null | undefined;
    }>;
}
