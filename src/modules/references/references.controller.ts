import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReferencesService } from './references.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';

@Controller('references')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReferencesController {
  constructor(private readonly svc: ReferencesService) {}

  @Get('provinces')
  getProvinces(@Query('q') q?: string) {
    return this.svc.getProvinces(q);
  }

  @Get('regencies')
  getRegencies(
    @Query('province_code') province_code?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.getRegencies(province_code, q);
  }

  @Get('districts')
  getDistricts(
    @Query('regency_code') regency_code?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.getDistricts(regency_code, q);
  }

  @Get('villages')
  getVillages(
    @Query('district_code') district_code?: string,
    @Query('q') q?: string,
  ) {
    return this.svc.getVillages(district_code, q);
  }

  @Get('nationalities')
  getNationalities(@Query('q') q?: string) {
    return this.svc.getNationalities(q);
  }

  @Get('industry-categories')
  getIndustryCategories() {
    return this.svc.getIndustryCategories();
  }

  @Get('monthly-income-ranges')
  getMonthlyIncomeRanges() {
    return this.svc.getMonthlyIncomeRanges();
  }
}
