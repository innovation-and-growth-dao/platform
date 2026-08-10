import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { DvService } from './dv.service';
import { DvVoteDto } from './dto';

@Controller()
export class DvController {
  constructor(private readonly dv: DvService) {}

  // Optional auth: the tally is public, but when a DRep is logged in we also return
  // their own vote (myChoice) so the UI can flag YES / NO / ABSTAIN / pending.
  @UseGuards(OptionalJwtAuthGuard)
  @Get('proposals/:id/dv-result')
  result(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() ctx?: AuthContext) {
    return this.dv.result(id, ctx?.userId);
  }

  // §9 — continuous per-category voting results for a round (the "Voting Result" tab). Public.
  @UseGuards(OptionalJwtAuthGuard)
  @Get('rounds/:roundId/voting-results')
  votingResults(@Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.dv.votingResults(roundId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/dv-vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DvVoteDto) {
    return this.dv.vote(ctx.userId, id, dto.choice, dto.rationale);
  }

  // §8.2 — a board member opts in to vote on this funding proposal.
  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/dv-opt-in')
  optIn(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.dv.optIn(ctx.userId, id);
  }
}
