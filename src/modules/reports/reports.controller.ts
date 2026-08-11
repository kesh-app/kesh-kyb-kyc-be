import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ReportsService } from './reports.service';
import { GenerateReportDto, ListReportsQueryDto } from './dto';

// RolesGuard auto-grants SystemAdmin + Director, so @Roles lists only the extras.
//
// @Roles di sini hanya pintu masuk kasar "punya akses Report Center atau tidak".
// Pembatasan sebenarnya — jenis report mana yang boleh per divisi — ada di
// ReportsService lewat report-access.ts, karena itu bergantung pada report_type
// yang tidak terlihat oleh RolesGuard. Auditor sengaja tidak ada di generate:
// read-only sesuai kebijakan yang berlaku.
const REPORT_READ_ROLES = [
  'ComplianceLead',
  'Auditor',
  'ComplaintHandling',
  'OperationSupervisor',
  'FinanceStaff',
  'FinanceManager',
] as const;

const REPORT_GENERATE_ROLES = [
  'ComplianceLead',
  'ComplaintHandling',
  'OperationSupervisor',
  'FinanceStaff',
  'FinanceManager',
] as const;

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Post('generate')
  @Roles(...REPORT_GENERATE_ROLES)
  async generate(@Req() req: any, @Body() dto: GenerateReportDto) {
    return this.svc.generate(req.user, dto);
  }

  @Get()
  @Roles(...REPORT_READ_ROLES)
  async list(@Req() req: any, @Query() query: ListReportsQueryDto) {
    return this.svc.list(query, req.user);
  }

  @Get(':id/status')
  @Roles(...REPORT_READ_ROLES)
  async status(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.svc.status(id, req.user);
  }

  @Get(':id/download')
  @Roles(...REPORT_READ_ROLES)
  async download(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.svc.download(id, req.user);
  }
}
