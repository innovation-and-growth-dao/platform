import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { DrepService } from './drep.service';
import { ExpertApplicationDto } from './dto';

// §2/§14 — an ADA holder applies to become an Expert (board then approves).
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeExpertController {
  constructor(private readonly drep: DrepService) {}

  @Post('expert-application')
  apply(@CurrentUser() ctx: AuthContext, @Body() dto: ExpertApplicationDto) {
    return this.drep.applyExpert(ctx.userId, dto);
  }

  @Get('expert')
  mine(@CurrentUser() ctx: AuthContext) {
    return this.drep.getMyExpert(ctx.userId);
  }

  // §2 — the expert voluntarily leaves; their profile is removed.
  @Post('expert/leave')
  leave(@CurrentUser() ctx: AuthContext) {
    return this.drep.leaveExpert(ctx.userId);
  }
}
