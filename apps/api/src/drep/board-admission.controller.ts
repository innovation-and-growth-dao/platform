import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { DrepService } from './drep.service';
import { AdmissionVoteDto } from './dto';

// §25.5 — board-only review of DRep applications.
@Controller('admin/drep-applications')
@UseGuards(JwtAuthGuard, BoardGuard)
export class BoardAdmissionController {
  constructor(private readonly drep: DrepService) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext, @Query('history') history?: string) {
    return this.drep.listApplications(ctx.userId, history === '1');
  }

  @Post(':drepId/vote')
  vote(
    @CurrentUser() ctx: AuthContext,
    @Param('drepId', ParseUUIDPipe) drepId: string,
    @Body() dto: AdmissionVoteDto,
  ) {
    return this.drep.voteOnApplication(ctx.userId, drepId, dto);
  }
}
