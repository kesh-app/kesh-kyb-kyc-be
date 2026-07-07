"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const db_module_1 = require("./modules/db/db.module");
const health_controller_1 = require("./modules/health/health.controller");
const users_module_1 = require("./modules/users/users.module");
const auth_module_1 = require("./modules/auth/auth.module");
const applications_module_1 = require("./modules/applications/applications.module");
const uploads_module_1 = require("./modules/uploads/uploads.module");
const business_module_1 = require("./modules/business/business.module");
const watchlist_module_1 = require("./modules/watchlist/watchlist.module");
const dashboard_module_1 = require("./modules/dashboard/dashboard.module");
const registrants_module_1 = require("./modules/registrants/registrants.module");
const transfers_module_1 = require("./modules/transfers/transfers.module");
const monitoring_module_1 = require("./modules/monitoring/monitoring.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [config_1.ConfigModule.forRoot({ isGlobal: true }), db_module_1.DbModule, users_module_1.UsersModule, auth_module_1.AuthModule, applications_module_1.ApplicationsModule, uploads_module_1.UploadsModule, business_module_1.BusinessModule, watchlist_module_1.WatchlistModule, dashboard_module_1.DashboardModule, registrants_module_1.RegistrantsModule, transfers_module_1.TransfersModule, monitoring_module_1.MonitoringModule],
        controllers: [health_controller_1.HealthController],
        providers: [],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map