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
  UpdateReportDto,
} from "./dto";

@Controller("monitoring")
@UseGuards(JwtAuthGuard, RolesGuard)
export class MonitoringController {
  constructor(private readonly svc: MonitoringService) {}

  // ── Read: list cases ──────────────────────────────────────────────────────
  // ComplianceLead, Auditor (read-only), Director. SystemAdmin via guard.
  // Director hanya melihat case PENDING_DIRECTOR_REVIEW (di-force di service).
  @Get("cases")
  @Roles("ComplianceLead", "Director", "Auditor")
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
  // Director hanya boleh membaca detail case PENDING_DIRECTOR_REVIEW (dijaga di service).
  @Get("cases/:id")
  @Roles("ComplianceLead", "Director", "Auditor")
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

  // ── Compliance review ─────────────────────────────────────────────────────
  @Patch("cases/:id/compliance-review")
  @Roles("ComplianceLead")
  async complianceReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ComplianceReviewDto,
  ) {
    return this.svc.complianceReview(id, dto, req.user);
  }

  // ── Director review ───────────────────────────────────────────────────────
  @Patch("cases/:id/director-review")
  @Roles("Director")
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
