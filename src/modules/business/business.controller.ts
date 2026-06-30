import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { BusinessService } from './business.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateBusinessPartyWithPersonDto, LinkExistingPersonDto } from './dto';

@Controller('business')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BusinessController {
  constructor(private readonly svc: BusinessService) {}

  // LIST all parties (directors/commissioners/manager/BO/auth rep)
  @Get(':id/parties')
  async list(@Param('id', ParseIntPipe) businessId: number) {
    return this.svc.listParties(businessId);
  }

  // CREATE person + link as a party
  @Roles('BranchAdmin','FrontDesk','ComplianceLead')
  @Post(':id/parties')
  async createWithPerson(
    @Param('id', ParseIntPipe) businessId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateBusinessPartyWithPersonDto,
  ) {
    return this.svc.addPartyWithNewPerson(businessId, dto);
  }

  // LINK existing person as a party
  @Roles('BranchAdmin','FrontDesk','ComplianceLead')
  @Post(':id/parties/link')
  async linkExisting(
    @Param('id', ParseIntPipe) businessId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: LinkExistingPersonDto,
  ) {
    return this.svc.linkExistingPerson(businessId, dto.person_id, dto.role);
  }

  // DELETE party
  @Roles('FrontDesk','ComplianceLead')
  @Delete(':id/parties/:partyId')
  async remove(
    @Param('id', ParseIntPipe) businessId: number,
    @Param('partyId', ParseIntPipe) partyId: number,
  ) {
    return this.svc.removeParty(businessId, partyId);
  }
}
