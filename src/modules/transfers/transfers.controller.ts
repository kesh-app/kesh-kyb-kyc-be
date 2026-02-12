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

  @Post()
  @Roles("FinanceStaff")
  create(@Req() req: any, @Body() dto: CreateTransferDto) {
    return this.svc.create(req.user, dto, req.ip);
  }

  @Patch(":id")
  @Roles("FinanceStaff")
  updateDraft(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateTransferDto
  ) {
    return this.svc.updateDraft(id, req.user, dto, req.ip);
  }

  @Post(":id/submit")
  @Roles("FinanceStaff")
  submit(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.submit(id, req.user, req.ip);
  }

  @Post(":id/decision")
  @Roles("FinanceManager")
  decide(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: DecideTransferDto
  ) {
    return this.svc.decide(id, req.user, dto, req.ip);
  }

  @Post(":id/result")
  @Roles("FinanceManager")
  setResult(
    @Req() req: any,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: SetTransferResultDto
  ) {
    return this.svc.setResult(id, req.user, dto, req.ip);
  }

  @Get()
  @Roles("FinanceStaff", "FinanceManager")
  list(@Req() req: any, @Query("status") status?: string) {
    return this.svc.list(req.user, status);
  }

  @Get(":id")
  @Roles("FinanceStaff", "FinanceManager")
  getById(@Req() req: any, @Param("id", ParseIntPipe) id: number) {
    return this.svc.getById(id, req.user);
  }
}
