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
  CreateComplaintDto,
  UpdateComplaintDto,
  ListComplaintsQueryDto,
} from "./dto";

@Controller("complaints")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ComplaintsController {
  constructor(private readonly svc: ComplaintsService) {}

  // SEARCH APPROVED CUSTOMERS — untuk dropdown Nama Customer
  @Get("customers/search")
  @Roles("FrontDesk", "OperationSupervisor", "FinanceManager", "Auditor")
  async searchCustomers(
    @Query("q") q = "",
    @Query("page") page = "1",
    @Query("limit") limit = "20",
  ) {
    return this.svc.searchCustomers(q, Number(page), Number(limit));
  }

  // SEARCH TRANSACTIONS — untuk dropdown Nomor Transaksi
  @Get("transactions/search")
  @Roles("FrontDesk", "OperationSupervisor", "FinanceManager", "Auditor")
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

  // CREATE COMPLAINT
  @Post()
  @Roles("FrontDesk")
  async create(@Req() req: any, @Body() dto: CreateComplaintDto) {
    return this.svc.create(req.user, dto);
  }

  // LIST COMPLAINTS
  @Get()
  @Roles("FrontDesk", "OperationSupervisor", "FinanceManager", "Auditor")
  async list(@Req() req: any, @Query() query: ListComplaintsQueryDto) {
    return this.svc.list(req.user, query);
  }

  // GET COMPLAINT DETAIL
  @Get(":id")
  @Roles("FrontDesk", "OperationSupervisor", "FinanceManager", "Auditor")
  async getById(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getById(id, req.user);
  }

  // UPDATE COMPLAINT (Auditor read-only — excluded)
  @Patch(":id")
  @Roles("FrontDesk", "OperationSupervisor", "FinanceManager")
  async update(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateComplaintDto,
  ) {
    return this.svc.update(id, req.user, dto);
  }
}
