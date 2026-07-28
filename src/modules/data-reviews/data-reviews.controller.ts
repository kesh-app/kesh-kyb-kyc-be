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
  ValidationPipe,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";
import { DataReviewsService } from "./data-reviews.service";
import {
  InitiateDataReviewDto,
  DataReviewDecisionDto,
  ListDataReviewsQueryDto,
} from "./dto";

// Worklist Pengkinian Data untuk menu FE.
// Read-only: FrontDesk + ComplianceLead + Auditor (SystemAdmin/Director via bypass).
// Aksi tetap lewat endpoint /applications/:id/data-review/* yang sudah ada.
@Controller("data-reviews")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DataReviewsListController {
  constructor(private readonly svc: DataReviewsService) {}

  @Get()
  @Roles("FrontDesk", "ComplianceLead", "Auditor")
  async list(
    @Query(new ValidationPipe({ whitelist: true, transform: true }))
    query: ListDataReviewsQueryDto,
  ) {
    return this.svc.list(query);
  }
}

// Pengkinian Data / Periodic Customer Data Review.
// Alur: ComplianceLead menganalisis & meminta pengkinian (initiate) → FrontDesk
// memperbarui data lewat form CDD/KYC/KYB yang ada lalu submit → ComplianceLead
// approve/return/reject.
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

  // INITIATE / REQUEST — ComplianceLead yang meminta pengkinian data, kapan saja
  // (tidak harus menunggu jatuh tempo).
  @Post("initiate")
  @Roles("ComplianceLead")
  async initiate(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: InitiateDataReviewDto,
  ) {
    return this.svc.initiate(id, req.user, dto);
  }

  // SUBMIT hasil pengkinian untuk direview Compliance — FrontDesk saja
  // (ComplianceLead tidak boleh submit mewakili FrontDesk).
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
