import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
export declare class AuthService {
    private users;
    private jwt;
    private readonly logger;
    constructor(users: UsersService, jwt: JwtService);
    validateAndLogin(email: string, password: string): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: "SystemAdmin" | "BranchAdmin" | "FrontDesk" | "ComplianceLead" | "Auditor" | "FinanceStaff" | "FinanceManager" | "Director";
        };
    }>;
    verifyUser(id: number): Promise<import("../users/users.service").UserRow | null>;
}
