import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

@Controller('me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext) {
    return this.svc.listMine(ctx.userId);
  }

  @Get('unread-count')
  async unread(@CurrentUser() ctx: AuthContext) {
    return { count: await this.svc.unreadCount(ctx.userId) };
  }

  @Post(':id/read')
  read(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(ctx.userId, id);
  }

  @Post('read-all')
  readAll(@CurrentUser() ctx: AuthContext) {
    return this.svc.markAllRead(ctx.userId);
  }
}
