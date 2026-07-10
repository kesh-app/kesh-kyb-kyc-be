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
import { TransfersService } from "./transfers.service";
import {
  CreateTransferDto,
  DecideTransferDto,
  SetTransferResultDto,
  UpdateTransferDto,
} from "./dto";

@Controller("transfers")
@UseGuards(JwtAuthGuard, RolesGuard)
export class TransfersController {
  constructor(private readonly svc: TransfersService) {}

  // CREATE TRANSFER → sekarang termasuk sender_application_id
  @Post()
  @Roles("FinanceStaff")
  async create(@Req() req: any, @Body() dto: CreateTransferDto) {
    // req.user → FinanceStaff atau FinanceManager yang membuat transfer
    return this.svc.create(req.user, dto, req.ip);
  }

  // UPDATE DRAFT
  @Patch(":id")
  @Roles("FinanceStaff")
  async updateDraft(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateTransferDto
  ) {
    return this.svc.updateDraft(id, req.user, dto, req.ip);
  }

  // SUBMIT
  @Post(":id/submit")
  @Roles("FinanceStaff")
  async submit(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.submit(id, req.user, req.ip);
  }

  // DECIDE (APPROVE / REJECT)
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
  @Get()
  @Roles("FinanceStaff", "FinanceManager", "SystemAdmin")
  async list(@Req() req: any, @Query("status") status?: string) {
    return this.svc.list(req.user, status);
  }

  // BANK CATALOG — static list for FE dropdown
  @Get("banks")
  @Roles("FinanceStaff", "FinanceManager", "ComplianceLead", "SystemAdmin")
  getBanks() {
    return this.svc.getBanks();
  }

  // SENDER SEARCH — cari aplikasi APPROVED sebagai calon pengirim transfer
  @Get("senders/search")
  @Roles("FinanceStaff", "FinanceManager", "ComplianceLead", "SystemAdmin")
  async searchSenders(
    @Query("q") q = "",
    @Query("page") page = "1",
    @Query("limit") limit = "20",
  ) {
    return this.svc.searchSenders(q, Number(page), Number(limit));
  }

  // SNAP PREVIEW — pure mapping of stored data, NO external bank/API call
  @Get(":id/snap-preview")
  @Roles("FinanceStaff", "FinanceManager", "SystemAdmin")
  async snapPreview(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.snapPreview(id, req.user);
  }

  // GET TRANSFER DETAIL
  @Get(":id")
  @Roles("FinanceStaff", "FinanceManager", "SystemAdmin")
  async getById(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getById(id, req.user);
  }
}