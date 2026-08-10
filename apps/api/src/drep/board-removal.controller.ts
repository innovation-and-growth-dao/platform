import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { DrepService } from './drep.service';
import { ProposeRemovalDto, RemovalVoteDto } from './dto';

// §14.4 — board-only removal of DAO members (3-of-5 vote).
@Controller('admin/removals')
@UseGuards(JwtAuthGuard, BoardGuard)
export class BoardRemovalController {
  constructor(private readonly drep: DrepService) {}

  @Get()
  list(@CurrentUser() ctx: AuthContext, @Query('history') history?: string) {
    return this.drep.listActiveRemovals(ctx.userId, history === '1');
  }

  @Get('removable-members')
  removable() {
    return this.drep.listRemovableMembers();
  }

  @Post()
  propose(@CurrentUser() ctx: AuthContext, @Body() dto: ProposeRemovalDto) {
    return this.drep.proposeRemoval(ctx.userId, dto.targetDrepId, dto.reason);
  }

  @Post(':id/vote')
  vote(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemovalVoteDto,
  ) {
    return this.drep.voteRemoval(ctx.userId, id, dto.choice, dto.rationale);
  }
}
