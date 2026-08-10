import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { MilestonesService } from './milestones.service';

export class PoaDto {
  @IsString() @MinLength(1) @MaxLength(20000) contentMd!: string;
}
export class MilestoneVoteDto {
  @IsIn(['YES', 'NO']) choice!: 'YES' | 'NO';
  @IsOptional() @IsString() @MaxLength(5000) rationale?: string;
}

/** Board picks a SET of reviewers (DReps and/or Experts) for the whole proposal. */
export class AssignReviewersDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  drepIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  expertIds?: string[];
}

/** Board swaps one assigned milestone reviewer for another DRep (vacancy / illness). */
export class ReplaceMilestoneReviewerDto {
  @IsUUID() oldDrepId!: string;
  @IsUUID() newDrepId!: string;
}

/** Reviewer or board member proposes stopping funding. */
export class StopFundingDto {
  @IsString() @MinLength(10) @MaxLength(5000) reason!: string;
}
/** Board casts a 1p1v vote on a stop-funding. */
export class StopFundingVoteDto {
  @IsIn(['YES', 'NO']) choice!: 'YES' | 'NO';
  @IsOptional() @IsString() @MaxLength(5000) rationale?: string;
}

@Controller()
export class MilestonesController {
  constructor(private readonly milestones: MilestonesService) {}

  // ---- public read ----
  @Get('proposals/:id/milestones')
  forProposal(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.forProposal(id);
  }

  @Get('milestones/:id/result')
  result(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.result(id);
  }

  @Get('proposals/:id/stop-fundings')
  stopFundings(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.stopFundingsForProposal(id);
  }

  // ---- reviewer / submitter ----
  @UseGuards(JwtAuthGuard)
  @Get('me/assignments/milestone')
  mine(@CurrentUser() ctx: AuthContext, @Query('history') history?: string) {
    return this.milestones.myAssignments(ctx.userId, history === '1' || history === 'true');
  }

  @UseGuards(JwtAuthGuard)
  @Post('milestones/:id/poa')
  poa(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PoaDto) {
    return this.milestones.submitPoa(ctx.userId, id, dto.contentMd);
  }

  @UseGuards(JwtAuthGuard)
  @Post('milestones/:id/vote')
  vote(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MilestoneVoteDto) {
    return this.milestones.vote(ctx.userId, id, dto.choice, dto.rationale);
  }

  /** Any assigned reviewer OR any board member may propose stopping funding. */
  @UseGuards(JwtAuthGuard)
  @Post('proposals/:id/stop-funding')
  proposeStop(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StopFundingDto) {
    return this.milestones.proposeStopFunding(ctx.userId, id, dto.reason);
  }

  /** Proposer withdraws their own ACTIVE stop-funding. */
  @UseGuards(JwtAuthGuard)
  @Post('stop-fundings/:id/withdraw')
  withdrawStop(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.withdrawStopFunding(ctx.userId, id);
  }

  /** Board members vote 1p1v on a stop-funding (3 YES → APPROVED → proposal FAILED). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('stop-fundings/:id/vote')
  voteStop(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StopFundingVoteDto) {
    return this.milestones.voteStopFunding(ctx.userId, id, dto.choice, dto.rationale);
  }

  /** Pending stop-funding count for a board member — drives the notification badge. */
  @UseGuards(JwtAuthGuard)
  @Get('me/pending-stop-funding')
  pendingStop(@CurrentUser() ctx: AuthContext) {
    return this.milestones.pendingStopFundingForBoard(ctx.userId).then((count) => ({ count }));
  }

  /** Board-wide list of every ACTIVE stop-funding (drives the Actions-tab panel). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Get('admin/stop-fundings/active')
  activeStop(@CurrentUser() ctx: AuthContext) {
    return this.milestones.activeStopFundingsForBoard(ctx.userId);
  }

  // ---- board ----

  /** Ranked candidate DReps for this proposal's milestone reviews (expertise + load). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Get('admin/proposals/:id/milestone-candidates')
  candidates(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.candidates(id);
  }

  /** Board picks the reviewer set (exactly `milestoneReviewerCount` DReps). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/assign-milestone-reviewers')
  assign(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignReviewersDto) {
    return this.milestones.assignReviewers(
      id,
      [
        ...(dto.drepIds ?? []).map((d) => ({ kind: 'DRep' as const, id: d })),
        ...(dto.expertIds ?? []).map((e) => ({ kind: 'Expert' as const, id: e })),
      ],
      ctx.userId,
    );
  }

  /** §11 — one-click random reviewer draw (mirrors filtering's draw-reviewers). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/draw-milestone-reviewers')
  draw(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.drawMilestoneReviewers(id, ctx.userId);
  }

  /** §11.5 — board grants the one-time extra deadline extension for a milestone. */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/milestones/:milestoneId/extend')
  extend(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() body: { days: number },
  ) {
    return this.milestones.grantBoardExtension(id, milestoneId, Number(body?.days));
  }

  /** Release the currently-assigned reviewers (only if no POA submitted yet). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/release-milestone-reviewers')
  release(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.releaseReviewers(id);
  }

  /** Swap one assigned milestone reviewer for another DRep (vacancy / illness). */
  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/replace-milestone-reviewer')
  replaceReviewer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceMilestoneReviewerDto) {
    return this.milestones.replaceReviewer(id, dto.oldDrepId, dto.newDrepId);
  }

  @UseGuards(JwtAuthGuard, BoardGuard)
  @Post('admin/proposals/:id/terminate')
  terminate(@Param('id', ParseUUIDPipe) id: string) {
    return this.milestones.terminate(id);
  }
}
