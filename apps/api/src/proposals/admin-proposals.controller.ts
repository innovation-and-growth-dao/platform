import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BoardGuard } from '../auth/board.guard';
import { CurrentUser, AuthContext } from '../auth/current-user.decorator';
import { ProposalsService } from './proposals.service';
import { BudgetChangeDecisionDto, ReviewFeeDto, ReviewPledgeDto, SettlePaymentDto } from './dto';

export class ReplaceReviewerDto {
  @IsUUID() oldDrepId!: string;
  @IsUUID() newDrepId!: string;
}
import { FilteringService } from './filtering.service';
import { DvService } from './dv.service';

// §26.5 — board overrides for proposals.
@Controller('admin/proposals')
@UseGuards(JwtAuthGuard, BoardGuard)
export class AdminProposalsController {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly filtering: FilteringService,
    private readonly dv: DvService,
  ) {}

  // §16 — proposals awaiting fee confirmation (board verifies the tx via explorer, then confirms).
  @Get('pending-fee')
  pendingFee() {
    return this.proposals.listPendingFee();
  }

  // §16 — board's fee-decision history (approved + fee-rejected), paginated.
  // ?limit=20&offset=0 → newest first; UI uses the count to render a pager.
  @Get('fee-history')
  feeHistory(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.proposals.listFeeHistory(
      limit ? Number(limit) : undefined,
      offset ? Number(offset) : undefined,
    );
  }

  // Approve (→ ACTIVE/Filtering) or reject (→ REJECTED, reason required) the submission fee.
  @Post(':id/review-fee')
  reviewFee(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewFeeDto) {
    return this.proposals.reviewFee(id, dto);
  }

  // §12 — pending budget-change requests awaiting board approval.
  @Get('pending-budget-changes')
  pendingBudgetChanges() {
    return this.proposals.listPendingBudgetChanges();
  }

  // §12 — board APPROVES a budget-change request → applies the change (votes
  // re-set if in FILTERING, fee delta queued); REJECTS → proposal stays as-is.
  @Post('budget-changes/:requestId/approve')
  approveBudgetChange(
    @CurrentUser() ctx: AuthContext,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: BudgetChangeDecisionDto,
  ) {
    return this.proposals.approveBudgetChange(ctx.userId, requestId, dto.feedback);
  }

  @Post('budget-changes/:requestId/reject')
  rejectBudgetChange(
    @CurrentUser() ctx: AuthContext,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: BudgetChangeDecisionDto,
  ) {
    return this.proposals.rejectBudgetChange(ctx.userId, requestId, dto.feedback ?? '');
  }

  // §3.4 — proposals waiting on the board to verify revenue-sharing conditions
  // before milestone work begins. Confirm with verify-revenue-sharing below.
  @Get('pending-revenue-sharing')
  pendingRevenueSharing() {
    return this.proposals.listPendingRevenueSharing();
  }

  @Post(':id/verify-revenue-sharing')
  verifyRevenueSharing(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.verifyRevenueSharing(ctx.userId, id);
  }

  // §11 — proposals awaiting reviewer assignment (filtering draw + milestone reviewers).
  @Get('pending-reviewer-assignment')
  pendingReviewerAssignment() {
    return this.proposals.listPendingReviewerAssignment();
  }

  // §16.4 — board extends the pledge grace window (resets the expiry alert).
  @Post(':id/extend-pledge-grace')
  extendPledgeGrace(@Param('id', ParseUUIDPipe) id: string, @Body() body: { days: number }) {
    return this.proposals.extendPledgeGrace(id, Number(body?.days));
  }

  // §3 — proposals in FUNDING awaiting pledge confirmation (the team pasted a tx,
  // the platform verifies it on-chain; the board approves or rejects).
  @Get('pending-pledge')
  pendingPledge() {
    return this.proposals.listPendingPledge();
  }

  // Confirm (→ pledgeConfirmedAt set, milestone POAs unlocked) or reject (→ tx
  // hash cleared, team re-pastes a corrected one) the pledge payment.
  @Post(':id/review-pledge')
  reviewPledge(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewPledgeDto) {
    return this.proposals.reviewPledge(id, dto);
  }

  // §12 — fee settlements (budget-change top-ups / refunds). `?history=1` includes settled ones.
  @Get('payments')
  payments(@Query('history') history?: string) {
    return this.proposals.listPayments(history === '1');
  }

  // Record the on-chain tx that settles a top-up/refund → SETTLED.
  @Post('payments/:id/settle')
  settlePayment(@CurrentUser() ctx: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SettlePaymentDto) {
    return this.proposals.settlePayment(ctx.userId, id, dto.txHash);
  }

  // §7.1 — draw filtering reviewers (normally automatic at submission-stage end).
  @Post(':id/draw-reviewers')
  drawReviewers(@Param('id', ParseUUIDPipe) id: string) {
    return this.filtering.drawReviewers(id);
  }

  // §7.1 — board's "Change reviewer" picker on a proposal in FILTERING. Returns
  // every eligible DRep with expertise + load + alreadyAssigned/alreadyVoted flags.
  // With ?all=1 also includes admitted DReps NOT in this round's eligibility —
  // picking one auto-adds them to the round on assignment.
  @Get(':id/filter-candidates')
  filterCandidates(@Param('id', ParseUUIDPipe) id: string, @Query('all') all?: string) {
    return this.filtering.candidates(id, { includeOutsideRound: all === '1' || all === 'true' });
  }

  // §7.1 — board swaps one filtering reviewer for another (blocked if the old
  // reviewer has already cast a vote).
  @Post(':id/replace-reviewer')
  replaceReviewer(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceReviewerDto,
  ) {
    return this.filtering.replaceReviewer(id, dto.oldDrepId, dto.newDrepId, ctx.userId);
  }

  // §4.3/§8 — snapshot voting power and open D&V voting.
  @Post(':id/open-dv-vote')
  openDvVote(@Param('id', ParseUUIDPipe) id: string) {
    return this.dv.openVoting(id);
  }

  // §9.3 — finalize D&V → APPROVED / REJECTED.
  @Post(':id/finalize-dv')
  finalizeDv(@Param('id', ParseUUIDPipe) id: string) {
    return this.dv.finalize(id);
  }
}
