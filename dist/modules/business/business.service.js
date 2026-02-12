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
exports.BusinessService = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
let BusinessService = class BusinessService {
    constructor(pool) {
        this.pool = pool;
    }
    async ensureBusiness(businessId) {
        const { rows } = await this.pool.query('SELECT id FROM business_entities WHERE id=$1', [businessId]);
        if (!rows[0])
            throw new common_1.NotFoundException('Business not found');
    }
    async createPerson(dto) {
        const q = await this.pool.query(`INSERT INTO persons (full_name, identity_type, identity_number, address_identity, pob, dob, nationality, phone, gender, occupation, email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (identity_type, identity_number) DO UPDATE
         SET full_name = EXCLUDED.full_name
       RETURNING id`, [
            dto.full_name, dto.identity_type, dto.identity_number, dto.address_identity,
            dto.pob, dto.dob, dto.nationality, dto.phone, dto.gender,
            dto.occupation || null, dto.email || null,
        ]);
        return q.rows[0].id;
    }
    async addPartyWithNewPerson(businessId, dto) {
        await this.ensureBusiness(businessId);
        const personId = await this.createPerson(dto);
        const res = await this.pool.query(`INSERT INTO business_parties (business_id, person_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (business_id, person_id, role) DO UPDATE SET is_active = TRUE, updated_at=now()
       RETURNING id, business_id, person_id, role, is_active, created_at`, [businessId, personId, dto.role]);
        return res.rows[0];
    }
    async linkExistingPerson(businessId, personId, role) {
        await this.ensureBusiness(businessId);
        const { rows: p } = await this.pool.query('SELECT id FROM persons WHERE id=$1', [personId]);
        if (!p[0])
            throw new common_1.NotFoundException('Person not found');
        const res = await this.pool.query(`INSERT INTO business_parties (business_id, person_id, role)
       VALUES ($1,$2,$3)
       ON CONFLICT (business_id, person_id, role) DO UPDATE SET is_active = TRUE, updated_at=now()
       RETURNING id, business_id, person_id, role, is_active, created_at`, [businessId, personId, role]);
        return res.rows[0];
    }
    async listParties(businessId) {
        await this.ensureBusiness(businessId);
        const { rows } = await this.pool.query(`SELECT bp.id, bp.role, bp.is_active, bp.created_at,
              p.id as person_id, p.full_name, p.identity_type, p.identity_number, p.phone
       FROM business_parties bp
       JOIN persons p ON p.id = bp.person_id
       WHERE bp.business_id = $1
       ORDER BY bp.created_at DESC`, [businessId]);
        return rows;
    }
    async removeParty(businessId, partyId) {
        await this.ensureBusiness(businessId);
        const { rows } = await this.pool.query(`DELETE FROM business_parties WHERE id=$1 AND business_id=$2 RETURNING id`, [partyId, businessId]);
        if (!rows[0])
            throw new common_1.NotFoundException('Party not found');
        return { ok: true };
    }
};
exports.BusinessService = BusinessService;
exports.BusinessService = BusinessService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)('PG_POOL')),
    __metadata("design:paramtypes", [pg_1.Pool])
], BusinessService);
//# sourceMappingURL=business.service.js.map