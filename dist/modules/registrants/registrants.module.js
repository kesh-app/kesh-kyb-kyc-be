"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RegistrantsModule = void 0;
// src/modules/registrants/registrants.module.ts
const common_1 = require("@nestjs/common");
const registrants_controller_1 = require("./registrants.controller");
let RegistrantsModule = class RegistrantsModule {
};
exports.RegistrantsModule = RegistrantsModule;
exports.RegistrantsModule = RegistrantsModule = __decorate([
    (0, common_1.Module)({ controllers: [registrants_controller_1.RegistrantsController] })
], RegistrantsModule);
//# sourceMappingURL=registrants.module.js.map