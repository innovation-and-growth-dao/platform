import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { FilteringService } from './filtering.service';
import { FilterVoteDto } from './dto';

@Controller()
export class FilteringController {
  constructor(private readonly filtering: FilteringService) {}

  @Get('proposals/:id/filter-result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.filtering.result(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/assignments/filter')
  mine(@CurrentUser() ctx: AuthContext, @Query('mode') mode?: string, @Query('history') history?: string) {
    // Back-compat: ?history=1 → 'history'; otherwise ?mode=pending|recent|history (default pending).
    const m = mode === 'recent' || mode === 'history' ? mode : history === '1' || history === 'true' ? 'history' : 'pending';
    return this.filtering.myAssignments(ctx.userId, m);
  }

  // Count of items awaiting this user in the "Voting & reviews" tab (filtering + D&V + milestone).
  @UseGuards(JwtAuthGuard)
  @Get('me/voting-tasks')
  votingTasks(@CurrentUser() ctx: AuthContext) {
    return this.filtering.votingTasksCount(ctx.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/filter-vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FilterVoteDto) {
    return this.filtering.vote(ctx.userId, id, dto.choice, dto.rationale);
  }
}
