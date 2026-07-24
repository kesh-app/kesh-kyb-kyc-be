import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { DataReviewsService } from "./data-reviews.service";
import { InitiateDataReviewDto, DataReviewDecisionDto } from "./dto";

// Pengkinian Data / Periodic Customer Data Review.
// Record ini melacak workflow/audit; data pengguna jasa yang diperbarui tetap
// disimpan lewat endpoint KYC/KYB yang ada (tidak diduplikasi di sini).
@Controller("applications/:id/data-review")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataReviewsController {
  constructor(private readonly svc: DataReviewsService) {}

  // STATUS — read-only (FrontDesk, ComplianceLead, Auditor; SystemAdmin/Director via bypass)
  @Get("status")
  @Roles("FrontDesk", "ComplianceLead", "Auditor")
  async status(@Param("id", ParseIntPipe) id: number) {
    return this.svc.getStatus(id);
  }

  // INITIATE — FrontDesk dapat memulai kapan saja (juga ComplianceLead)
  @Post("initiate")
  @Roles("FrontDesk", "ComplianceLead")
  async initiate(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: InitiateDataReviewDto,
  ) {
    return this.svc.initiate(id, req.user, dto);
  }

  // SUBMIT untuk direview Compliance — FrontDesk
  @Post("submit")
  @Roles("FrontDesk")
  async submit(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.submit(id, req.user);
  }

  // DECISION — ComplianceLead (approve / return / reject)
  @Post("decision")
  @Roles("ComplianceLead")
  async decision(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DataReviewDecisionDto,
  ) {
    return this.svc.decision(id, req.user, dto);
  }
}
