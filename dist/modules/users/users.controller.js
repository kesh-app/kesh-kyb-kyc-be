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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const jwt_guard_1 = require("../auth/jwt.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const users_service_1 = require("./users.service");
const admin_dto_1 = require("./admin.dto"); // kalau DTO-nya kamu pisah file, ganti import
let UsersController = class UsersController {
    constructor(usersService) {
        this.usersService = usersService;
    }
    // 👉 List admin internal
    async listAdmins() {
        return this.usersService.listAdmins();
    }
    // 👉 Buat admin baru
    async createAdmin(req, dto) {
        return this.usersService.createAdmin(dto, req.user.id);
    }
    // 👉 Update role / is_active / branch
    async updateAdmin(req, id, dto) {
        return this.usersService.updateAdmin(id, dto, req.user.id);
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)('admins'),
    (0, roles_decorator_1.Roles)('SystemAdmin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "listAdmins", null);
__decorate([
    (0, common_1.Post)('admins'),
    (0, roles_decorator_1.Roles)('SystemAdmin'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, admin_dto_1.CreateAdminUserDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "createAdmin", null);
__decorate([
    (0, common_1.Patch)('admins/:id'),
    (0, roles_decorator_1.Roles)('SystemAdmin'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, admin_dto_1.UpdateAdminUserDto]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "updateAdmin", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(jwt_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], UsersController);
//# sourceMappingURL=users.controller.js.map