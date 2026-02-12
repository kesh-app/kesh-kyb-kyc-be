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
exports.DashboardController = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const jwt_guard_1 = require("../auth/jwt.guard");
const roles_guard_1 = require("../auth/roles.guard");
let DashboardController = class DashboardController {
    constructor(pool) {
        this.pool = pool;
    }
    async summary(limit = '5') {
        const lim = Math.max(1, Math.min(50, Number(limit) || 5));
        // total per status dari applications
        const { rows: statusRows } = await this.pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM applications
      GROUP BY status
    `);
        // bucket risk dari risk_profiles (LOW/MEDIUM/HIGH/PROHIBITED)
        const { rows: riskRows } = await this.pool.query(`
      SELECT rp.risk_level AS level, COUNT(*)::int AS count
      FROM risk_profiles rp
      GROUP BY rp.risk_level
    `);
        // recent submissions + field tampilan (JOIN ke persons & business_entities)
        const { rows: recent } = await this.pool.query(`
      SELECT
        a.id,
        a.type,
        a.status,
        a.created_at,
        a.submitted_at,
        rp.risk_level,
        rp.score_total AS risk_score,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.full_name,'')
             ELSE NULLIF(b.legal_name,'')
        END AS full_name,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.email,'')
             ELSE NULL
        END AS email,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN 'KTP/PASPOR'    -- (placeholder, bisa diubah jika kamu simpan tipe identitas)
             ELSE 'NPWP/NIB'
        END AS id_type
      FROM applications a
      LEFT JOIN risk_profiles      rp ON rp.application_id = a.id
      LEFT JOIN persons            p  ON p.id            = a.person_id
      LEFT JOIN business_entities  b  ON b.id            = a.business_id
      ORDER BY a.created_at DESC
      LIMIT $1
      `, [lim]);
        const { rows: totalRows } = await this.pool.query(`SELECT COUNT(*)::int AS total FROM applications`);
        const totals = {
            total: totalRows[0]?.total ?? 0,
            status: Object.fromEntries(statusRows.map(r => [r.status, r.count])),
            risk: Object.fromEntries(riskRows.map(r => [r.level ?? 'UNKNOWN', r.count])),
        };
        return { totals, recent };
    }
    // Opsional: kalau FE masih memanggil /kyc/submissions?limit=5
    async submissions(limit = '5') {
        const lim = Math.max(1, Math.min(50, Number(limit) || 5));
        const { rows } = await this.pool.query(`
      SELECT
        a.id,
        a.type,
        a.status,
        a.created_at,
        a.submitted_at,
        rp.risk_level,
        rp.score_total AS risk_score,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.full_name,'')
             ELSE NULLIF(b.legal_name,'')
        END AS full_name,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN NULLIF(p.email,'')
             ELSE NULL
        END AS email,
        CASE WHEN a.type = 'INDIVIDUAL'
             THEN 'KTP/PASPOR'
             ELSE 'NPWP/NIB'
        END AS id_type
      FROM applications a
      LEFT JOIN risk_profiles      rp ON rp.application_id = a.id
      LEFT JOIN persons            p  ON p.id            = a.person_id
      LEFT JOIN business_entities  b  ON b.id            = a.business_id
      ORDER BY a.created_at DESC
      LIMIT $1
      `, [lim]);
        return rows;
    }
};
exports.DashboardController = DashboardController;
__decorate([
    (0, common_1.Get)('dashboard-summary'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "summary", null);
__decorate([
    (0, common_1.Get)('submissions'),
    __param(0, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DashboardController.prototype, "submissions", null);
exports.DashboardController = DashboardController = __decorate([
    (0, common_1.UseGuards)(jwt_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    (0, common_1.Controller)('kyc'),
    __param(0, (0, common_1.Inject)('PG_POOL')),
    __metadata("design:paramtypes", [pg_1.Pool])
], DashboardController);
//# sourceMappingURL=dashboard.controller.js.map