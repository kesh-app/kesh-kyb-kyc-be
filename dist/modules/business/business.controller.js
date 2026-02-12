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
exports.BusinessController = void 0;
const common_1 = require("@nestjs/common");
const business_service_1 = require("./business.service");
const jwt_guard_1 = require("../auth/jwt.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const dto_1 = require("./dto");
let BusinessController = class BusinessController {
    constructor(svc) {
        this.svc = svc;
    }
    // LIST all parties (directors/commissioners/manager/BO/auth rep)
    async list(businessId) {
        return this.svc.listParties(businessId);
    }
    // CREATE person + link as a party
    async createWithPerson(businessId, dto) {
        return this.svc.addPartyWithNewPerson(businessId, dto);
    }
    // LINK existing person as a party
    async linkExisting(businessId, dto) {
        return this.svc.linkExistingPerson(businessId, dto.person_id, dto.role);
    }
    // DELETE party
    async remove(businessId, partyId) {
        return this.svc.removeParty(businessId, partyId);
    }
};
exports.BusinessController = BusinessController;
__decorate([
    (0, common_1.Get)(':id/parties'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], BusinessController.prototype, "list", null);
__decorate([
    (0, roles_decorator_1.Roles)('BranchAdmin', 'ComplianceReviewer', 'ComplianceLead'),
    (0, common_1.Post)(':id/parties'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ whitelist: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.CreateBusinessPartyWithPersonDto]),
    __metadata("design:returntype", Promise)
], BusinessController.prototype, "createWithPerson", null);
__decorate([
    (0, roles_decorator_1.Roles)('BranchAdmin', 'ComplianceReviewer', 'ComplianceLead'),
    (0, common_1.Post)(':id/parties/link'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ whitelist: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.LinkExistingPersonDto]),
    __metadata("design:returntype", Promise)
], BusinessController.prototype, "linkExisting", null);
__decorate([
    (0, roles_decorator_1.Roles)('ComplianceReviewer', 'ComplianceLead'),
    (0, common_1.Delete)(':id/parties/:partyId'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('partyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number]),
    __metadata("design:returntype", Promise)
], BusinessController.prototype, "remove", null);
exports.BusinessController = BusinessController = __decorate([
    (0, common_1.Controller)('business'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [business_service_1.BusinessService])
], BusinessController);
//# sourceMappingURL=business.controller.js.map