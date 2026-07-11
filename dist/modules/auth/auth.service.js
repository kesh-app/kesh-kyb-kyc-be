"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("../users/users.service");
const jwt_1 = require("@nestjs/jwt");
function extractDbError(err) {
    // AggregateError (ES2021) contains an `errors` array — duck-type it since target is ES2020
    const aggregate = err;
    if (Array.isArray(aggregate?.errors)) {
        return aggregate.errors
            .map((e) => (e instanceof Error ? e.message : String(e)))
            .join(' | ');
    }
    return err instanceof Error ? err.message : String(err);
}
let AuthService = AuthService_1 = class AuthService {
    constructor(users, jwt) {
        this.users = users;
        this.jwt = jwt;
        this.logger = new common_1.Logger(AuthService_1.name);
    }
    async validateAndLogin(email, password) {
        let u;
        try {
            u = await this.users.findByEmail(email);
        }
        catch (err) {
            this.logger.error(`DB error during login for "${email}": ${extractDbError(err)}`);
            throw new common_1.InternalServerErrorException('Database unavailable — please try again or contact support');
        }
        if (!u)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const ok = await this.users.verifyPassword(password, u.password_hash);
        if (!ok)
            throw new common_1.UnauthorizedException('Invalid credentials');
        try {
            await this.users.touchLastLogin(u.id);
        }
        catch (err) {
            // Non-fatal: login still succeeds even if last_login_at update fails
            this.logger.warn(`Could not update last_login_at for user ${u.id}: ${extractDbError(err)}`);
        }
        const payload = { sub: u.id, role: u.role, email: u.email };
        const access_token = await this.jwt.signAsync(payload);
        return {
            access_token,
            user: { id: u.id, name: u.name, email: u.email, role: u.role },
        };
    }
    async verifyUser(id) {
        return this.users.findById(id);
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [users_service_1.UsersService, jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map