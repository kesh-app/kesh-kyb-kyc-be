"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationsModule = void 0;
const common_1 = require("@nestjs/common");
const db_module_1 = require("../db/db.module");
const applications_service_1 = require("./applications.service");
const applications_controller_1 = require("./applications.controller");
const uploads_module_1 = require("../uploads/uploads.module");
let ApplicationsModule = class ApplicationsModule {
};
exports.ApplicationsModule = ApplicationsModule;
exports.ApplicationsModule = ApplicationsModule = __decorate([
    (0, common_1.Module)({
        imports: [db_module_1.DbModule, uploads_module_1.UploadsModule],
        providers: [applications_service_1.ApplicationsService],
        controllers: [applications_controller_1.ApplicationsController],
    })
], ApplicationsModule);
//# sourceMappingURL=applications.module.js.map