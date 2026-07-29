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
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { ComplaintsService } from "./complaints.service";
import {
  AmlReviewDto,
  CloseComplaintDto,
  ComplaintFinanceReviewDto,
  CreateComplaintDto,
  ListComplaintsQueryDto,
  OperationInvestigationDto,
  ResolveComplaintDto,
  UpdateComplaintDto,
  VerifyComplaintDataDto,
} from "./dto";

// Semua role yang boleh melihat tiket pengaduan. FrontDesk sengaja TIDAK termasuk:
// sejak workflow baru, kepemilikan tiket ada di ComplaintHandling.
const VIEW_ROLES = [
  "ComplaintHandling",
  "OperationSupervisor",
  "ComplianceLead",
  "FinanceStaff",
  "FinanceManager",
  "Auditor",
] as const;

// Pembagian aksi (di luar SystemAdmin/Director yang bypass di RolesGuard):
//   ComplaintHandling  → create, update, verify-data, resolve, close
//   OperationSupervisor→ operation-investigation
//   ComplianceLead     → aml-review
//   FinanceStaff       → finance-review (approval refund tetap di statement-refunds)
//   FinanceManager     → read-only di modul ini
//   Auditor            → read-only
@Controller("complaints")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ComplaintsController {
  constructor(private readonly svc: ComplaintsService) {}

  // SEARCH APPROVED CUSTOMERS — untuk dropdown Nama Customer
  @Get("customers/search")
  @Roles(...VIEW_ROLES)
  async searchCustomers(
    @Query("q") q = "",
    @Query("page") page = "1",
    @Query("limit") limit = "20",
  ) {
    return this.svc.searchCustomers(q, Number(page), Number(limit));
  }

  // SEARCH TRANSACTIONS — untuk dropdown Nomor Transaksi
  @Get("transactions/search")
  @Roles(...VIEW_ROLES)
  async searchTransactions(
    @Query("customer_application_id") customerAppId: string,
    @Query("q") q = "",
    @Query("page") page = "1",
    @Query("limit") limit = "20",
  ) {
    if (!customerAppId) {
      throw new BadRequestException("customer_application_id is required");
    }
    return this.svc.searchTransactions(
      Number(customerAppId),
      q,
      Number(page),
      Number(limit),
    );
  }

  // CREATE COMPLAINT — pemilik tiket
  @Post()
  @Roles("ComplaintHandling")
  async create(@Req() req: any, @Body() dto: CreateComplaintDto) {
    return this.svc.create(req.user, dto);
  }

  // LIST COMPLAINTS
  @Get()
  @Roles(...VIEW_ROLES)
  async list(@Req() req: any, @Query() query: ListComplaintsQueryDto) {
    return this.svc.list(req.user, query);
  }

  // GET COMPLAINT DETAIL
  @Get(":id")
  @Roles(...VIEW_ROLES)
  async getById(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getById(id, req.user);
  }

  // UPDATE COMPLAINT — data tiket & catatan komunikasi
  @Patch(":id")
  @Roles("ComplaintHandling")
  async update(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateComplaintDto,
  ) {
    return this.svc.update(id, req.user, dto);
  }

  // VERIFIKASI DATA NASABAH
  @Post(":id/verify-data")
  @Roles("ComplaintHandling")
  async verifyData(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: VerifyComplaintDataDto,
  ) {
    return this.svc.verifyData(id, req.user, dto);
  }

  // INVESTIGASI TRANSAKSI
  @Post(":id/operation-investigation")
  @Roles("OperationSupervisor")
  async operationInvestigation(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: OperationInvestigationDto,
  ) {
    return this.svc.operationInvestigation(id, req.user, dto);
  }

  // AML / COMPLIANCE REVIEW
  @Post(":id/aml-review")
  @Roles("ComplianceLead")
  async amlReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AmlReviewDto,
  ) {
    return this.svc.amlReview(id, req.user, dto);
  }

  // FINANCE REVIEW — menentukan perlu refund atau tidak
  @Post(":id/finance-review")
  @Roles("FinanceStaff")
  async financeReview(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ComplaintFinanceReviewDto,
  ) {
    return this.svc.financeReview(id, req.user, dto);
  }

  // RESOLVE
  @Post(":id/resolve")
  @Roles("ComplaintHandling")
  async resolve(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: ResolveComplaintDto,
  ) {
    return this.svc.resolve(id, req.user, dto);
  }

  // CLOSE — manual, tidak pernah dipicu oleh statement refund
  @Post(":id/close")
  @Roles("ComplaintHandling")
  async close(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CloseComplaintDto,
  ) {
    return this.svc.close(id, req.user, dto);
  }
}
