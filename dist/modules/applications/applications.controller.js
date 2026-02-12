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
exports.ApplicationsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const applications_service_1 = require("./applications.service");
const dto_1 = require("./dto");
const jwt_guard_1 = require("../auth/jwt.guard");
const roles_decorator_1 = require("../auth/roles.decorator");
const roles_guard_1 = require("../auth/roles.guard");
const uploads_service_1 = require("../uploads/uploads.service");
let ApplicationsController = class ApplicationsController {
    constructor(svc, uploads) {
        this.svc = svc;
        this.uploads = uploads;
    }
    async list(limit = 20, offset = 0) {
        return this.svc.list(Number(limit), Number(offset));
    }
    async detail(appId) {
        return this.svc.getDetail(appId);
    }
    /** (Opsional) quick pre-check tanpa submit */
    async precheck(appId) {
        return this.svc.validateBeforeSubmit(appId);
    }
    async createInd(req, dto) {
        return this.svc.createIndividual(dto, req.user.sub, 1);
    }
    async createBiz(req, dto) {
        return this.svc.createBusiness(dto, req.user.sub, 1);
    }
    async addDoc(appId, dto) {
        return this.svc.addDocument(appId, {
            doc_type: dto.doc_type,
            file_uri: dto.file_uri,
        });
    }
    async listParties(appId) {
        return this.svc.listParties(appId);
    }
    async addParty(appId, dto) {
        return this.svc.addParty(appId, dto);
    }
    async removeParty(appId, partyId) {
        return this.svc.deleteParty(appId, partyId);
    }
    // detail aplikasi sdh ada; tambahkan endpoint hasil screening & risk
    async screening(appId) {
        const { rows: results } = await this.svc["pool"].query(`SELECT subject_type, subject_ref, list_type, watchlist_id, matched_name, matched_dob, matched_nationality, score, created_at
     FROM screening_results WHERE application_id=$1 ORDER BY score DESC, created_at DESC`, [appId]);
        const { rows: risk } = await this.svc["pool"].query(`SELECT application_id, risk_score, risk_level, factors, created_at FROM application_risk WHERE application_id=$1`, [appId]);
        return { results, risk: risk[0] || null };
    }
    async listDocs(appId) {
        return this.svc.listDocuments(appId);
    }
    async getDoc(appId, docId) {
        return this.svc.getDocument(appId, docId);
    }
    async uploadDocument(appId, file, docType) {
        if (!file)
            throw new common_1.BadRequestException("No file uploaded");
        const ext = mimeToExt(file.mimetype);
        const { url, key } = await this.uploads.uploadBuffer(file.buffer, file.mimetype, ext);
        const saved = await this.svc.addDocument(appId, {
            doc_type: docType || inferDocType(file.originalname),
            file_uri: url,
            extracted_json: {
                object_key: key,
                mime: file.mimetype,
                size: file.size ?? null,
                original_name: file.originalname ?? null,
            },
        });
        return { ...saved, file_url: url };
    }
    async submit(appId, req) {
        return this.svc.submit(appId, req.user.sub);
    }
    async deleteDoc(appId, docId) {
        const doc = await this.svc.deleteDocument(appId, docId);
        const key = doc?.extracted_json?.object_key;
        if (key)
            await this.uploads.deleteObject?.(key);
        return { ok: true, deleted_id: docId };
    }
};
exports.ApplicationsController = ApplicationsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)("limit")),
    __param(1, (0, common_1.Query)("offset")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "detail", null);
__decorate([
    (0, common_1.Get)(":id/precheck"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "precheck", null);
__decorate([
    (0, roles_decorator_1.Roles)("BranchAdmin", "ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Post)("individual"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ whitelist: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateIndividualDto]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "createInd", null);
__decorate([
    (0, roles_decorator_1.Roles)("BranchAdmin", "ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Post)("business"),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ whitelist: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, dto_1.CreateBusinessDto]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "createBiz", null);
__decorate([
    (0, roles_decorator_1.Roles)("BranchAdmin", "ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Post)(":id/documents"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ whitelist: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.AddDocumentDto]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "addDoc", null);
__decorate([
    (0, roles_decorator_1.Roles)("BranchAdmin", "ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Get)(":id/parties"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "listParties", null);
__decorate([
    (0, roles_decorator_1.Roles)("BranchAdmin", "ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Post)(":id/parties"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)(new common_1.ValidationPipe({ whitelist: true }))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, dto_1.CreatePartyDto]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "addParty", null);
__decorate([
    (0, roles_decorator_1.Roles)("BranchAdmin", "ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Delete)(":id/parties/:partyId"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)("partyId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "removeParty", null);
__decorate([
    (0, common_1.Get)(":id/screening"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "screening", null);
__decorate([
    (0, common_1.Get)(":id/documents"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "listDocs", null);
__decorate([
    (0, common_1.Get)(":id/documents/:docId"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)("docId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "getDoc", null);
__decorate([
    (0, roles_decorator_1.Roles)("BranchAdmin", "ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Post)(":id/documents/upload"),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)("file", {
        limits: {
            fileSize: Number(process.env.MAX_UPLOAD_MB || 10) * 1024 * 1024,
        },
        fileFilter: (req, file, cb) => {
            const allowed = ["image/png", "image/jpeg", "application/pdf"];
            if (!allowed.includes(file.mimetype)) {
                return cb(new common_1.BadRequestException("File type not allowed"), false);
            }
            cb(null, true);
        },
    })),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)("doc_type")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, String]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "uploadDocument", null);
__decorate([
    (0, roles_decorator_1.Roles)("ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Patch)(":id/submit"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "submit", null);
__decorate([
    (0, roles_decorator_1.Roles)("ComplianceReviewer", "ComplianceLead"),
    (0, common_1.Delete)(":id/documents/:docId"),
    __param(0, (0, common_1.Param)("id", common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)("docId", common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number]),
    __metadata("design:returntype", Promise)
], ApplicationsController.prototype, "deleteDoc", null);
exports.ApplicationsController = ApplicationsController = __decorate([
    (0, common_1.Controller)("applications"),
    (0, common_1.UseGuards)(jwt_guard_1.JwtAuthGuard, roles_guard_1.RolesGuard),
    __metadata("design:paramtypes", [applications_service_1.ApplicationsService,
        uploads_service_1.UploadsService])
], ApplicationsController);
function mimeToExt(mime) {
    if (mime === "image/png")
        return "png";
    if (mime === "image/jpeg")
        return "jpg";
    if (mime === "application/pdf")
        return "pdf";
    return "";
}
function inferDocType(name) {
    const n = (name || "").toUpperCase();
    if (n.includes("KTP"))
        return "KTP";
    if (n.includes("PASPOR"))
        return "PASPOR";
    if (n.includes("SIM"))
        return "SIM";
    if (n.includes("AKTA"))
        return "AKTA_PENDIRIAN";
    if (n.includes("NIB") || n.includes("SIUP"))
        return "NIB_SIUP";
    if (n.includes("NPWP"))
        return "NPWP_BADAN";
    return "OTHER";
}
//# sourceMappingURL=applications.controller.js.map