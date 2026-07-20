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
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Post('generate')
  @Roles('ComplianceLead')
  async generate(@Req() req: any, @Body() dto: GenerateReportDto) {
    return this.svc.generate(req.user, dto);
  }

  @Get()
  @Roles('ComplianceLead', 'Auditor')
  async list(@Query() query: ListReportsQueryDto) {
    return this.svc.list(query);
  }

  @Get(':id/status')
  @Roles('ComplianceLead', 'Auditor')
  async status(@Param('id', ParseIntPipe) id: number) {
    return this.svc.status(id);
  }

  @Get(':id/download')
  @Roles('ComplianceLead', 'Auditor')
  async download(@Param('id', ParseIntPipe) id: number) {
    return this.svc.download(id);
  }
}
