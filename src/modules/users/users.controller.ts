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
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UsersService } from './users.service';
import { CreateAdminUserDto, UpdateAdminUserDto } from './admin.dto';// kalau DTO-nya kamu pisah file, ganti import

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
    return this.usersService.createAdmin(dto, req.user.id);
  }

  // 👉 Update role / is_active / branch
  @Patch('admins/:id')
  @Roles('SystemAdmin')
  async updateAdmin(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdminUserDto,
  ) {
    return this.usersService.updateAdmin(id, dto, req.user.id);
  }
}
