import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, type AuthContext } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { QuickPollService } from './quick-poll.service';
import { QuickPollVoteDto } from '../messages/dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class QuickPollController {
  constructor(private readonly polls: QuickPollService) {}

  // §9.2 — all quick polls of a round (with my vote/eligibility when logged in).
  @Get('rounds/:roundId/quick-polls')
  list(@CurrentUser() ctx: AuthContext, @Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.polls.listForRound(roundId, ctx.userId);
  }

  // Board's one-click confirm — opens the 48h voting window.
  @Post('admin/quick-polls/:id/launch')
  @UseGuards(BoardGuard)
  launch(@Param('id', ParseUUIDPipe) id: string) {
    return this.polls.launch(id);
  }

  // Board closes a poll early (e.g. at the end of Tally) — finalises with the votes cast so far.
  @Post('admin/quick-polls/:id/resolve')
  @UseGuards(BoardGuard)
  resolve(@Param('id', ParseUUIDPipe) id: string) {
    return this.polls.resolve(id, { force: true });
  }

  // Eligible DRep submits/updates their ranked tie-break preference.
  @Post('quick-polls/:id/vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: QuickPollVoteDto) {
    return this.polls.vote(ctx.userId, id, dto.ranking);
  }

  // Polls awaiting MY vote (badge).
  @Get('me/pending-quick-polls')
  async mine(@CurrentUser() ctx: AuthContext) {
    return { count: await this.polls.myPendingCount(ctx.userId) };
  }
}
