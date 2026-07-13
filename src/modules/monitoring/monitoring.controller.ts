import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { MonitoringService } from "./monitoring.service";
import {
  ComplianceReviewDto,
  DirectorReviewDto,
  ManagerReviewDto,
  StaffReviewDto,
  UpdateReportDto,
} from "./dto";

@Controller("monitoring")
@UseGuards(JwtAuthGuard, RolesGuard)
export class MonitoringController {
  constructor(private readonly svc: MonitoringService) {}

  // ── Read: list cases ──────────────────────────────────────────────────────
  // ComplianceLead (review & approval), Auditor (read-only).
  // Director/SystemAdmin via guard bypass.
  @Get("cases")
  @Roles("ComplianceLead", "Auditor")
  async listCases(@Req() req: any, @Query() query: any) {
    return this.svc.listCases(query, req.user);
  }

  // ── Read: report queue ────────────────────────────────────────────────────
  // Report queue adalah tahap setelah persetujuan Dirut → Director TIDAK punya akses.
  @Get("reports")
  @Roles("ComplianceLead", "Auditor")
  async listReports(@Query() query: any) {
    return this.svc.listReports(query);
  }

  // ── Read: case detail ─────────────────────────────────────────────────────
  @Get("cases/:id")
  @Roles("ComplianceLead", "Auditor")
  async getCase(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getCase(id, req.user);
  }

  // ── Manual evaluation of a transfer ───────────────────────────────────────
  @Post("evaluate-transfer/:transferId")
  @Roles("ComplianceLead")
  async evaluateTransfer(
    @Req() req: any,
    @Param("transferId", ParseIntPipe) transferId: number,
  ) {
    return this.svc.evaluateTransfer(transferId, req.user);
  }

  // ── Staff review (approval pertama — ComplianceLead) ─────────────────────
  @Patch("cases/:id/staff-review")
  @Roles("ComplianceLead")
  async staffReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: StaffReviewDto,
  ) {
    return this.svc.staffReview(id, dto, req.user);
  }

  // ── Manager review (approval kedua — ComplianceLead / Compliance Manager) ─
  @Patch("cases/:id/manager-review")
  @Roles("ComplianceLead")
  async managerReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ManagerReviewDto,
  ) {
    return this.svc.managerReview(id, dto, req.user);
  }

  // ── Legacy aliases (deprecated) — dipertahankan sementara untuk FE lama ───
  // compliance-review → staff-review (ComplianceLead), director-review → manager-review.
  @Patch("cases/:id/compliance-review")
  @Roles("ComplianceLead")
  async complianceReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ComplianceReviewDto,
  ) {
    return this.svc.complianceReview(id, dto, req.user);
  }

  @Patch("cases/:id/director-review")
  @Roles("ComplianceLead")
  async directorReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DirectorReviewDto,
  ) {
    return this.svc.directorReview(id, dto, req.user);
  }

  // ── Report update ─────────────────────────────────────────────────────────
  @Patch("cases/:id/report")
  @Roles("ComplianceLead")
  async updateReport(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateReportDto,
  ) {
    return this.svc.updateReport(id, dto, req.user);
  }
}
