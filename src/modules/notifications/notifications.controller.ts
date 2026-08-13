import { Controller, Get, Param, ParseIntPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { resolveUserId } from '../../common/auth.util';
import { NotificationsService } from './notifications.service';

// No @Roles() here on purpose — every authenticated user reads their own
// notifications, scoped by recipient_user_id from the JWT, never by role.
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  async list(@Req() req: any, @Query('limit') limit?: string) {
    return this.svc.list(resolveUserId(req.user), limit ? Number(limit) : undefined);
  }

  @Get('count')
  async count(@Req() req: any) {
    return { count: await this.svc.unreadCount(resolveUserId(req.user)) };
  }

  @Post(':id/read')
  async markRead(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    return this.svc.markRead(resolveUserId(req.user), id);
  }

  @Post('read-all')
  async markAllRead(@Req() req: any) {
    await this.svc.markAllRead(resolveUserId(req.user));
    return { ok: true };
  }
}
