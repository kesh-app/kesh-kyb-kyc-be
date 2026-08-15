import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { TransfersService } from "./transfers.service";
import {
  ComplianceReviewDecisionDto,
  CreateBulkTransferDto,
  CreateTransferDto,
  DecideTransferDto,
  ReviewTransferDto,
  FinanceReviewTransferDto,
  RescreenTransferDto,
  SetTransferResultDto,
  SubmitComplianceReviewDto,
  UpdateTransferDto,
} from "./dto";
import { QLOLA_PURPOSES, type QlolaPurpose } from "./bri-qlola.exporter";

// Hak baca transfer (SystemAdmin/Director lewat bypass RolesGuard).
const READ_ROLES = [
  "FinanceStaff",
  "FinanceManager",
  "OperationSupervisor",
  "ComplianceLead",
  "Auditor",
  "FrontDesk",
] as const;

@Controller("transfers")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransfersController {
  constructor(private readonly svc: TransfersService) {}

  // CREATE TRANSFER → sekarang termasuk sender_application_id
  // Input transfer = FrontDesk saja (+ SystemAdmin/Director via bypass).
  // FinanceStaff adalah layer review finance, bukan input transfer.
  @Post()
  @Roles("FrontDesk")
  async create(@Req() req: any, @Body() dto: CreateTransferDto) {
    return this.svc.create(req.user, dto, req.ip);
  }

  // BULK TRANSFER → mass input (maks 20 item). Setiap item jadi transfer DRAFT
  // normal; alur approval yang ada tetap berlaku per transfer.
  // Input transfer = FrontDesk saja (+ SystemAdmin/Director via bypass).
  // FinanceStaff adalah layer review finance, bukan input transfer.
  @Post("bulk")
  @Roles("FrontDesk")
  async createBulk(@Req() req: any, @Body() dto: CreateBulkTransferDto) {
    return this.svc.bulkCreate(req.user, dto, req.ip);
  }

  // UPDATE DRAFT
  @Patch(":id")
  @Roles("FinanceStaff", "FrontDesk")
  async updateDraft(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateTransferDto
  ) {
    return this.svc.updateDraft(id, req.user, dto, req.ip);
  }

  // SUBMIT
  @Post(":id/submit")
  @Roles("FinanceStaff", "FrontDesk")
  async submit(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.submit(id, req.user, req.ip);
  }

  // SUBMIT FOR COMPLIANCE REVIEW (flagged transfer) — Admin/Frontline
  // FrontDesk (+ SystemAdmin/Director via RolesGuard full access)
  @Post(":id/submit-compliance-review")
  @Roles("FrontDesk", "SystemAdmin", "Director")
  async submitComplianceReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: SubmitComplianceReviewDto
  ) {
    return this.svc.submitComplianceReview(id, req.user, dto, req.ip);
  }

  // COMPLIANCE REVIEW DECISION — ComplianceLead
  @Post(":id/compliance-review")
  @Roles("ComplianceLead", "SystemAdmin", "Director")
  async complianceReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ComplianceReviewDecisionDto
  ) {
    return this.svc.complianceReview(id, req.user, dto, req.ip);
  }

  // RESCREEN WATCHLIST — historical false-positive cleanup, ComplianceLead
  // (+ SystemAdmin/Director via RolesGuard full access). Read-only preview untuk
  // transfer COMPLETED/REJECTED kecuali force=true — lihat rescreenWatchlist().
  @Post(":id/rescreen-watchlist")
  @Roles("ComplianceLead", "SystemAdmin", "Director")
  async rescreenWatchlist(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RescreenTransferDto,
  ) {
    return this.svc.rescreenWatchlist(id, req.user, dto.force === true, req.ip);
  }

  // SUPERVISOR REVIEW (layer 1) — OperationSupervisor
  @Post(":id/supervisor-review")
  @Roles("OperationSupervisor")
  async supervisorReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ReviewTransferDto
  ) {
    return this.svc.supervisorReview(id, req.user, dto, req.ip);
  }

  // FINANCE STAFF REVIEW (layer 2) — APPROVE / REJECT / RETURN
  @Post(":id/finance-review")
  @Roles("FinanceStaff")
  async financeReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: FinanceReviewTransferDto
  ) {
    return this.svc.financeReview(id, req.user, dto, req.ip);
  }

  // DECIDE (APPROVE / REJECT) — FinanceManager final
  @Post(":id/decision")
  @Roles("FinanceManager")
  async decide(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DecideTransferDto
  ) {
    return this.svc.decide(id, req.user, dto, req.ip);
  }

  // SET RESULT (SUCCESS / FAILED)
  @Post(":id/result")
  @Roles("FinanceManager")
  async setResult(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: SetTransferResultDto
  ) {
    return this.svc.setResult(id, req.user, dto, req.ip);
  }

  // LIST TRANSFERS
  // transfer_mode: all (default, perilaku lama) | single | bulk_item
  @Get()
  @Roles(...READ_ROLES)
  async list(
    @Req() req: any,
    @Query("status") status?: string,
    @Query("transfer_mode") transferMode?: string,
  ) {
    return this.svc.list(req.user, status, { transferMode });
  }

  // BULK BATCH LIST — satu baris per batch (bukan per transfer anak).
  // Harus dideklarasikan sebelum @Get(":id") agar tidak tertangkap ParseIntPipe.
  @Get("bulk-batches")
  @Roles(...READ_ROLES)
  async listBulkBatches(
    @Req() req: any,
    @Query("q") q?: string,
    @Query("date_from") dateFrom?: string,
    @Query("date_to") dateTo?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.svc.listBulkBatches(req.user, {
      q,
      date_from: dateFrom,
      date_to: dateTo,
      page: Number(page),
      limit: Number(limit),
    });
  }

  // EXPORT BRI QLOLA (BI-Fast)
  //
  //   ?purpose=FINAL  (default) — transfer anak COMPLETED/SUCCESS, siap dieksekusi
  //   ?purpose=REVIEW           — transfer anak PENDING_FINANCE_STAFF_REVIEW,
  //                               dipakai Finance Staff untuk mengecek data
  //                               rekening/bank penerima sebelum menyetujui
  //
  // purpose dihilangkan = FINAL, supaya client lama tidak berubah perilakunya.
  //
  // Sengaja lebih ketat dari READ_ROLES: file ini dipakai untuk mengeksekusi
  // uang di Qlola, jadi hanya peran yang memproses/menyetujui yang boleh
  // mengunduhnya. FrontDesk (pembuat batch) TIDAK termasuk — membuat pencatatan
  // bukan berarti boleh menarik instruksi pembayaran ke bank.
  // ComplianceLead, OperationSupervisor, ComplaintHandling & Auditor juga tidak:
  // peran pengawasan, bukan pelaksana. Kedua tujuan memakai daftar peran yang
  // sama; FinanceStaff memang pemakai utama jalur REVIEW.
  // SystemAdmin/Director tetap masuk lewat bypass RolesGuard.
  //
  // Harus dideklarasikan sebelum @Get("bulk-batches/:id")? Tidak — path ini
  // lebih panjang dan spesifik, jadi tidak bentrok.
  @Get("bulk-batches/:id/exports/bri-qlola")
  @Roles("FinanceStaff", "FinanceManager")
  async exportBriQlola(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Res() res: Response,
    @Query("purpose") purpose?: string,
  ) {
    const requested = (purpose ?? "FINAL").toUpperCase();
    if (!QLOLA_PURPOSES.includes(requested as QlolaPurpose)) {
      throw new BadRequestException(
        `purpose harus salah satu dari: ${QLOLA_PURPOSES.join(", ")}`,
      );
    }

    const { fileName, buffer, eligible_count, total_count } =
      await this.svc.exportBriQlola(id, req.user, requested as QlolaPurpose);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    // Dipakai FE untuk memberi tahu "12 dari 15 transaksi siap diekspor".
    res.setHeader("X-Qlola-Eligible-Count", String(eligible_count));
    res.setHeader("X-Qlola-Total-Count", String(total_count));
    res.setHeader("X-Qlola-Purpose", requested);
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Disposition, X-Qlola-Eligible-Count, X-Qlola-Total-Count, X-Qlola-Purpose",
    );
    res.end(buffer);
  }

  // BULK BATCH DETAIL — ringkasan batch + seluruh transfer anak.
  @Get("bulk-batches/:id")
  @Roles(...READ_ROLES)
  async getBulkBatch(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getBulkBatchById(id, req.user);
  }

  // BANK CATALOG — static list for FE dropdown
  @Get("banks")
  @Roles("FinanceStaff", "FinanceManager", "OperationSupervisor", "ComplianceLead", "FrontDesk", "Auditor")
  getBanks() {
    return this.svc.getBanks();
  }

  // SENDER SEARCH — cari aplikasi APPROVED sebagai calon pengirim transfer
  @Get("senders/search")
  @Roles("FinanceStaff", "FinanceManager", "OperationSupervisor", "ComplianceLead", "FrontDesk", "Auditor")
  async searchSenders(
    @Query("q") q = "",
    @Query("page") page = "1",
    @Query("limit") limit = "20",
  ) {
    return this.svc.searchSenders(q, Number(page), Number(limit));
  }

  // SNAP PREVIEW — pure mapping of stored data, NO external bank/API call
  @Get(":id/snap-preview")
  @Roles("FinanceStaff", "FinanceManager", "OperationSupervisor", "Auditor", "FrontDesk")
  async snapPreview(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.snapPreview(id, req.user);
  }

  // GET TRANSFER DETAIL
  @Get(":id")
  @Roles("FinanceStaff", "FinanceManager", "OperationSupervisor", "ComplianceLead", "Auditor", "FrontDesk")
  async getById(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getById(id, req.user);
  }
}