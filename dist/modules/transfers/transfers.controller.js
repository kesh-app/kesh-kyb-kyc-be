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
exports.TransfersController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../auth/jwt.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const transfers_service_1 = require("./transfers.service");
const dto_1 = require("./dto");
let TransfersController = class TransfersController {
    constructor(svc) {
        this.svc = svc;
    }
    // CREATE TRANSFER → sekarang termasuk sender_application_id
    async create(req, dto) {
        // req.user → FinanceStaff atau FinanceManager yang membuat transfer
        return this.svc.create(req.user, dto, req.ip);
    }
    // UPDATE DRAFT
    async updateDraft(req, id, dto) {
        return this.svc.updateDraft(id, req.user, dto, req.ip);
    }
    // SUBMIT
    async submit(req, id) {
        return this.svc.submit(id, req.user, req.ip);
    }
    // DECIDE (APPROVE / REJECT)
    async decide(req, id, dto) {
        return this.svc.decide(id, req.user, dto, req.ip);
    }
    // SET RESULT (SUCCESS / FAILED)
    async setResult(req, id, dto) {
        return this.svc.setResult(id, req.user, dto, req.ip);
    }
    // LIST TRANSFERS
    async list(req, status) {
        return this.svc.list(req.user, status);
    }
    // SNAP PREVIEW — pure mapping of stored data, NO external bank/API call
    async snapPreview(req, id) {
        return this.svc.snapPreview(id, req.user);
    }
    // GET TRANSFER DETAIL
    async getById(req, id) {
        return this.svc.getById(id, req.user);
    }
};
exports.TransfersController = TransfersController;
__decorate([
    (0, common_1.Post)(),
    (0, roles_decorator_1.Roles)("FinanceStaff"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateTransferDto]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(":id"),
    (0, roles_decorator_1.Roles)("FinanceStaff"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, dto_1.UpdateTransferDto]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "updateDraft", null);
__decorate([
    (0, common_1.Post)(":id/submit"),
    (0, roles_decorator_1.Roles)("FinanceStaff"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "submit", null);
__decorate([
    (0, common_1.Post)(":id/decision"),
    (0, roles_decorator_1.Roles)("FinanceManager"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, dto_1.DecideTransferDto]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "decide", null);
__decorate([
    (0, common_1.Post)(":id/result"),
    (0, roles_decorator_1.Roles)("FinanceManager"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, dto_1.SetTransferResultDto]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "setResult", null);
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_1.Roles)("FinanceStaff", "FinanceManager", "SystemAdmin"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)("status")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id/snap-preview"),
    (0, roles_decorator_1.Roles)("FinanceStaff", "FinanceManager", "SystemAdmin"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "snapPreview", null);
__decorate([
    (0, common_1.Get)(":id"),
    (0, roles_decorator_1.Roles)("FinanceStaff", "FinanceManager", "SystemAdmin"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], TransfersController.prototype, "getById", null);
exports.TransfersController = TransfersController = __decorate([
    (0, common_1.Controller)("transfers"),
    (0, common_1.UseGuards)(jwt_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [transfers_service_1.TransfersService])
], TransfersController);
//# sourceMappingURL=transfers.controller.js.map