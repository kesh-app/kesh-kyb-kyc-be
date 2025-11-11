import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
declare const JwtStrategy_base: new (...args: any[]) => Strategy;
export declare class JwtStrategy extends JwtStrategy_base {
    constructor(cs: ConfigService);
    validate(payload: {
        sub: number;
        role: string;
        email: string;
    }): Promise<{
        sub: number;
        role: string;
        email: string;
    }>;
}
export {};
