import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { DrepService } from './drep.service';
import { DrepApplicationDto, UpdateDrepDto } from './dto';

// §25.4 — the authenticated user's own DRep profile / application.
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeDrepController {
  constructor(private readonly drep: DrepService) {}

  @Post('drep-application')
  apply(@CurrentUser() ctx: AuthContext, @Body() dto: DrepApplicationDto) {
    return this.drep.apply(ctx.userId, dto);
  }

  @Get('drep')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.drep.getMine(ctx.userId);
  }

  // §14.4 — a pending board removal vote targeting me (null if none).
  @Get('removal')
  myRemoval(@CurrentUser() ctx: AuthContext) {
    return this.drep.getMyActiveRemoval(ctx.userId);
  }

  // §14.1 — whether I meet the (configurable) on-chain requirements to request DAO entry.
  @Get('entry-eligibility')
  entryEligibility(@CurrentUser() ctx: AuthContext) {
    return this.drep.entryEligibility(ctx.userId);
  }

  @Patch('drep')
  update(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateDrepDto) {
    return this.drep.updateMine(ctx.userId, dto);
  }

  // §14 — voluntarily leave the DAO (board members are managed via genesis, not here).
  @Post('leave-dao')
  leave(@CurrentUser() ctx: AuthContext) {
    return this.drep.leaveDao(ctx.userId);
  }
}
