"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const bcrypt = __importStar(require("bcryptjs"));
let UsersService = class UsersService {
    constructor(pool) {
        this.pool = pool;
    }
    async findByEmail(email) {
        const { rows } = await this.pool.query("SELECT * FROM users WHERE email=$1 LIMIT 1", [email]);
        return rows[0] || null;
    }
    async findById(id) {
        const { rows } = await this.pool.query("SELECT * FROM users WHERE id=$1 LIMIT 1", [id]);
        return rows[0] || null;
    }
    async verifyPassword(plain, hash) {
        return bcrypt.compare(plain, hash);
    }
    async touchLastLogin(userId) {
        await this.pool.query("UPDATE users SET last_login_at = now() WHERE id=$1", [userId]);
    }
    async listAdmins() {
        const res = await this.pool.query(`SELECT
       id,
       email,
       name AS full_name,      -- ✅ pakai kolom name, alias jadi full_name
       role,
       branch_id,
       is_active,
       created_at
     FROM users
     ORDER BY id DESC`);
        return res.rows;
    }
    async createAdmin(dto, actorId) {
        // cek email unik
        const existing = await this.pool.query("SELECT id FROM users WHERE email = $1", [dto.email]);
        const emailCount = existing.rowCount ?? 0;
        if (emailCount > 0) {
            throw new common_1.BadRequestException("Email already exists");
        }
        const passwordHash = await bcrypt.hash(dto.password, 10);
        const res = await this.pool.query(`INSERT INTO users (
      name,
      email,
      password_hash,
      role,
      branch_id,
      is_active,
      created_at
   )
   VALUES ($1,$2,$3,$4,$5,TRUE,now())
   RETURNING
     id,
     email,
     name AS full_name,
     role,
     branch_id,
     is_active,
     created_at`, [dto.fullName, dto.email, passwordHash, dto.role, dto.branchId ?? null]);
        const user = res.rows[0];
        await this.pool.query(`INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json)
       VALUES ($1,'USER_CREATE','USER',$2,NULL,$3)`, [actorId, String(user.id), user]);
        return user;
    }
    async updateAdmin(id, dto, actorId) {
        const existing = await this.pool.query(`SELECT
      id,
      email,
      name AS full_name,    -- ✅ alias
      role,
      branch_id,
      is_active
   FROM users
   WHERE id = $1`, [id]);
        const rowCount = existing.rowCount ?? 0;
        if (rowCount === 0) {
            throw new common_1.NotFoundException("User not found");
        }
        const before = existing.rows[0];
        const nextRole = dto.role ?? before.role;
        const nextActive = dto.isActive !== undefined ? dto.isActive : before.is_active;
        const nextBranch = dto.branchId !== undefined ? dto.branchId : before.branch_id;
        const res = await this.pool.query(`UPDATE users
   SET role = $2,
       is_active = $3,
       branch_id = $4
   WHERE id = $1
   RETURNING
     id,
     email,
     name AS full_name,
     role,
     branch_id,
     is_active,
     created_at`, [id, nextRole, nextActive, nextBranch]);
        const after = res.rows[0];
        await this.pool.query(`INSERT INTO audit_logs(actor_id, action, object_type, object_id, before_json, after_json)
       VALUES ($1,'USER_UPDATE_ADMIN','USER',$2,$3,$4)`, [actorId, String(id), before, after]);
        return after;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)("PG_POOL")),
    __metadata("design:paramtypes", [pg_1.Pool])
], UsersService);
//# sourceMappingURL=users.service.js.map