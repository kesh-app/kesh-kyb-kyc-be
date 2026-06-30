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
exports.WatchlistController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const watchlist_service_1 = require("./watchlist.service");
const jwt_guard_1 = require("../auth/jwt.guard");
const roles_guard_1 = require("../auth/roles.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const dto_1 = require("./dto");
const auth_util_1 = require("../../common/auth.util");
let WatchlistController = class WatchlistController {
    constructor(svc) {
        this.svc = svc;
    }
    async upload(file, body, req) {
        if (!file)
            throw new common_1.BadRequestException("No file uploaded");
        return this.svc.ingestBuffer(file.buffer, body.list_type, body.list_source, Number((0, auth_util_1.resolveUserId)(req.user)), file.originalname);
    }
    async history(limit) {
        const n = Math.min(Number(limit) || 20, 100);
        return this.svc.listIngestHistory(n);
    }
};
exports.WatchlistController = WatchlistController;
__decorate([
    (0, roles_decorator_1.Roles)("FrontDesk", "ComplianceLead"),
    (0, common_1.Post)("upload"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        limits: {
            fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
        },
        fileFilter: (req, file, cb) => {
            const ok = [
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-excel",
                "text/csv",
            ].includes(file.mimetype) ||
                /\.xlsx?$/i.test(file.originalname) ||
                /\.csv$/i.test(file.originalname);
            if (!ok)
                return cb(new common_1.BadRequestException("Only .xlsx/.xls/.csv allowed"), false);
            cb(null, true);
        },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.UploadWatchlistDto, Object]),
    __metadata("design:returntype", Promise)
], WatchlistController.prototype, "upload", null);
__decorate([
    (0, roles_decorator_1.Roles)("FrontDesk", "ComplianceLead", "SystemAdmin"),
    (0, common_1.Get)("history"),
    __param(0, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], WatchlistController.prototype, "history", null);
exports.WatchlistController = WatchlistController = __decorate([
    (0, common_1.Controller)("watchlist"),
    (0, common_1.UseGuards)(jwt_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [watchlist_service_1.WatchlistService])
], WatchlistController);
//# sourceMappingURL=watchlist.controller.js.map