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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdatePartyActiveDto = exports.LinkExistingPersonDto = exports.CreateBusinessPartyWithPersonDto = void 0;
const class_validator_1 = require("class-validator");
class CreateBusinessPartyWithPersonDto {
}
exports.CreateBusinessPartyWithPersonDto = CreateBusinessPartyWithPersonDto;
__decorate([
    (0, class_validator_1.IsIn)(['DIRECTOR', 'COMMISSIONER', 'MANAGER', 'BO', 'AUTHORIZED_REP']),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "role", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "full_name", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['KTP', 'SIM', 'PASPOR', 'LAINNYA']),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "identity_type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "identity_number", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "address_identity", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "pob", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "dob", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "nationality", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsIn)(['M', 'F', 'O']),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "gender", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "occupation", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateBusinessPartyWithPersonDto.prototype, "email", void 0);
class LinkExistingPersonDto {
}
exports.LinkExistingPersonDto = LinkExistingPersonDto;
__decorate([
    (0, class_validator_1.IsIn)(['DIRECTOR', 'COMMISSIONER', 'MANAGER', 'BO', 'AUTHORIZED_REP']),
    __metadata("design:type", String)
], LinkExistingPersonDto.prototype, "role", void 0);
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], LinkExistingPersonDto.prototype, "person_id", void 0);
class UpdatePartyActiveDto {
}
exports.UpdatePartyActiveDto = UpdatePartyActiveDto;
//# sourceMappingURL=dto.js.map