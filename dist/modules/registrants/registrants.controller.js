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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistrantsController = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const jwt_guard_1 = require("../auth/jwt.guard");
const roles_guard_1 = require("../auth/roles.guard");
let RegistrantsController = class RegistrantsController {
    constructor(pool) {
        this.pool = pool;
    }
    async list(type = 'INDIVIDUAL', // INDIVIDUAL | BUSINESS
    q = '', status, // DRAFT|SUBMITTED|IN_REVIEW|ESCALATED|APPROVED|REJECTED
    limit = '50', offset = '0') {
        const lim = Math.max(1, Math.min(100, Number(limit) || 50));
        const off = Math.max(0, Number(offset) || 0);
        const isInd = String(type).toUpperCase() !== 'BUSINESS';
        // WHERE
        const wh = [];
        const params = [];
        wh.push(`a.type = $${params.push(isInd ? 'INDIVIDUAL' : 'BUSINESS')}`);
        if (status) {
            wh.push(`a.status = $${params.push(status.toUpperCase())}`);
        }
        if (q) {
            // cari di nama, email/phone (individu), nib/npwp (bisnis)
            if (isInd) {
                wh.push(`(
            p.full_name ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(p.email,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(p.phone,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(p.name_norm,'') ILIKE $${params.push(`%${q}%`)}
          )`);
            }
            else {
                wh.push(`(
            b.legal_name ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.trade_name,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.nib,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.npwp,'') ILIKE $${params.push(`%${q}%`)} OR
            COALESCE(b.name_norm,'') ILIKE $${params.push(`%${q}%`)}
          )`);
            }
        }
        const whereSql = wh.length ? `WHERE ${wh.join(' AND ')}` : '';
        const sql = `
      SELECT
        a.id AS application_id,
        a.type,
        a.status,
        a.created_at,
        COALESCE(ar.override_level, ar.risk_level) AS risk_level,
        ar.risk_score,
        ${isInd
            ? `p.full_name          AS display_name,
             p.email              AS email,
             p.phone              AS phone,
             NULL::text           AS nib,
             NULL::text           AS npwp`
            : `b.legal_name         AS display_name,
             NULL::text           AS email,
             NULL::text           AS phone,
             b.nib                AS nib,
             b.npwp               AS npwp`},
        COUNT(*) OVER()::int AS total_rows
      FROM applications a
      LEFT JOIN application_risk ar ON ar.application_id = a.id
      ${isInd ? 'LEFT JOIN persons p ON p.id = a.person_id'
            : 'LEFT JOIN business_entities b ON b.id = a.business_id'}
      ${whereSql}
      ORDER BY a.created_at DESC
      LIMIT $${params.push(lim)}
      OFFSET $${params.push(off)}
    `;
        const { rows } = await this.pool.query(sql, params);
        const total = rows[0]?.total_rows ?? 0;
        return {
            total,
            limit: lim,
            offset: off,
            items: rows.map(r => ({
                application_id: r.application_id,
                type: r.type,
                status: r.status,
                created_at: r.created_at,
                risk_level: r.risk_level,
                risk_score: r.risk_score,
                display_name: r.display_name,
                email: r.email,
                phone: r.phone,
                nib: r.nib,
                npwp: r.npwp,
            })),
        };
    }
};
exports.RegistrantsController = RegistrantsController;
__decorate([
    (0, common_1.Get)('registrants'),
    __param(0, (0, common_1.Query)('type')),
    __param(1, (0, common_1.Query)('q')),
    __param(2, (0, common_1.Query)('status')),
    __param(3, (0, common_1.Query)('limit')),
    __param(4, (0, common_1.Query)('offset')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String, Object, Object]),
    __metadata("design:returntype", Promise)
], RegistrantsController.prototype, "list", null);
exports.RegistrantsController = RegistrantsController = __decorate([
    (0, common_1.UseGuards)(jwt_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('kyc'),
    __param(0, (0, common_1.Inject)('PG_POOL')),
    __metadata("design:paramtypes", [pg_1.Pool])
], RegistrantsController);
//# sourceMappingURL=registrants.controller.js.map