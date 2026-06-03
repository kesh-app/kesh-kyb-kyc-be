import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  Query
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './admin.dto';// kalau DTO-nya kamu pisah file, ganti import
import { resolveUserId } from '../../common/auth.util';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // 👉 List admin internal
  @Get('admins')
  @Roles('SystemAdmin')
  async listAdmins() {
    return this.usersService.listAdmins();
  }

  // 👉 Buat admin baru
  @Post('admins')
  @Roles('SystemAdmin')
  async createAdmin(@Req() req: any, @Body() dto: CreateAdminUserDto) {
    return this.usersService.createAdmin(dto, resolveUserId(req.user) as number);
  }

  // 👉 Update role / is_active / branch
  @Patch('admins/:id')
  @Roles('SystemAdmin')
  async updateAdmin(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.usersService.updateAdmin(id, dto, resolveUserId(req.user) as number);
  }

  @Get(':applicationId')
async getUser(@Param('applicationId') applicationId: number) {
  return this.usersService.getUserByApplicationId(applicationId);
}

  /** List semua user individu (pagination opsional) */
  @Get()
  async listIndividuals(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const l = limit ? parseInt(limit) : 50;
    const o = offset ? parseInt(offset) : 0;
    return this.usersService.listIndividuals(l, o);
  }

}
