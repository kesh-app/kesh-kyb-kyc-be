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
import { StatementRefundsService } from "./statement-refunds.service";
import {
  CreateStatementRefundDto,
  ListStatementRefundsQueryDto,
  MatchStatementRefundDto,
  StatementRefundDecisionDto,
  UpdateStatementRefundDto,
} from "./dto";

// Statement Refund / Pencatatan Refund — layer audit ke-2.
// Complaint (layer 1) tidak otomatis tertutup oleh refund, dan pembuatan refund
// tidak otomatis mengkredit saldo (layer 3). Kredit saldo hanya lewat approval
// FinanceManager di endpoint /decision.
//
// Maker-checker: FinanceStaff mencatat/mencocokkan/mengajukan, FinanceManager
// hanya memutuskan. FinanceManager sengaja tidak boleh create/update/match/submit
// supaya tidak menyetujui pekerjaannya sendiri.
@Controller("statement-refunds")
@UseGuards(JwtAuthGuard, RolesGuard)
export class StatementRefundsController {
  constructor(private readonly svc: StatementRefundsService) {}

  // LIST — Finance kerja, Compliance/Auditor/FrontDesk read-only
  @Get()
  @Roles("FinanceStaff", "FinanceManager", "ComplianceLead", "Auditor", "FrontDesk")
  async list(@Query() query: ListStatementRefundsQueryDto) {
    return this.svc.list(query);
  }

  @Get(":id")
  @Roles("FinanceStaff", "FinanceManager", "ComplianceLead", "Auditor", "FrontDesk")
  async detail(@Param("id", ParseIntPipe) id: number) {
    return this.svc.getById(id);
  }

  // RECEIPT — hanya refund APPROVED. FrontDesk boleh cetak, tapi tetap
  // read-only (tidak ada aksi Finance di route ini).
  @Get(":id/receipt")
  @Roles("FinanceStaff", "FinanceManager", "ComplianceLead", "Auditor", "FrontDesk")
  async receipt(@Param("id", ParseIntPipe) id: number) {
    return this.svc.getReceipt(id);
  }

  // CREATE — pencatatan mutasi refund dari rekening koran (maker = FinanceStaff)
  @Post()
  @Roles("FinanceStaff")
  async create(@Req() req: any, @Body() dto: CreateStatementRefundDto) {
    return this.svc.create(req.user, dto);
  }

  @Patch(":id")
  @Roles("FinanceStaff")
  async update(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateStatementRefundDto,
  ) {
    return this.svc.update(id, req.user, dto);
  }

  // MATCH ke transaksi asal — tidak pernah mengkredit saldo
  @Post(":id/match")
  @Roles("FinanceStaff")
  async match(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: MatchStatementRefundDto,
  ) {
    return this.svc.match(id, req.user, dto);
  }

  // SUBMIT untuk approval — FinanceStaff (maker), bukan FinanceManager (checker)
  @Post(":id/submit")
  @Roles("FinanceStaff")
  async submit(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.submit(id, req.user);
  }

  // DECISION — FinanceManager: satu-satunya gerbang kredit saldo
  @Post(":id/decision")
  @Roles("FinanceManager")
  async decision(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: StatementRefundDecisionDto,
  ) {
    return this.svc.decision(id, req.user, dto);
  }
}
