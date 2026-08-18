import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { BusinessService } from './business.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CreateBusinessPartyWithPersonDto, LinkExistingPersonDto } from './dto';
import {
  KYC_EDIT_ROUTE_ROLES,
  KYC_PARTY_CREATE_ROUTE_ROLES,
} from '../../common/kyc-access';

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
  @Roles(...KYC_PARTY_CREATE_ROUTE_ROLES)
  @Post(':id/parties')
  async createWithPerson(
    @Param('id', ParseIntPipe) businessId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: CreateBusinessPartyWithPersonDto,
    @Req() req: any,
  ) {
    return this.svc.addPartyWithNewPerson(businessId, dto, req.user.role);
  }

  // LINK existing person as a party
  @Roles(...KYC_PARTY_CREATE_ROUTE_ROLES)
  @Post(':id/parties/link')
  async linkExisting(
    @Param('id', ParseIntPipe) businessId: number,
    @Body(new ValidationPipe({ whitelist: true })) dto: LinkExistingPersonDto,
    @Req() req: any,
  ) {
    return this.svc.linkExistingPerson(businessId, dto.person_id, dto.role, req.user.role);
  }

  // DELETE party
  @Roles(...KYC_EDIT_ROUTE_ROLES)
  @Delete(':id/parties/:partyId')
  async remove(
    @Param('id', ParseIntPipe) businessId: number,
    @Param('partyId', ParseIntPipe) partyId: number,
    @Req() req: any,
  ) {
    return this.svc.removeParty(businessId, partyId, req.user.role);
  }
}
